// HTTP handlers for the paper library endpoints, including the range-capable
// PDF streaming endpoint consumed by the browser's native PDF viewer via an
// embedded iframe/object.
import type { Context } from 'koa'
import { createReadStream, existsSync, statSync } from 'fs'
import type { PaperRecord } from './paper-store'
import {
  MultipartParseError,
  parseMultipartBoundary,
  parseMultipartFilename,
  splitMultipart,
} from '../../studio/public/multipart'
import * as svc from './paper-service'

// The extracted PDF is capped by the service; this extra headroom only
// absorbs multipart framing so a full-size PDF is not rejected for its
// envelope bytes.
const MULTIPART_FRAMING_SLACK_BYTES = 1024 * 1024

interface ParsedUpload {
  filename: string | null
  fields: Record<string, string>
  data: Buffer | null
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function requiredId(ctx: Context): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: 'id is required' }
  return null
}

function rejectBadRequest(ctx: Context, err: unknown): void {
  const error = err as { status?: number; message?: string }
  ctx.status = typeof error?.status === 'number' ? error.status : 400
  ctx.body = { error: error?.message || 'invalid paper request' }
}

async function readBodyWithLimit(ctx: Context, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of ctx.req as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > maxBytes) {
      throw tooLarge()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function tooLarge(): Error {
  return Object.assign(
    new Error(`paper PDF is too large (max ${svc.getMaxPaperBytes()} bytes)`),
    { status: 413 },
  )
}

function parseMultipartUpload(contentType: string, raw: Buffer): ParsedUpload {
  const boundary = parseMultipartBoundary(contentType)
  if (!boundary) throw invalid('missing multipart boundary')
  const result: ParsedUpload = { filename: null, fields: {}, data: null }
  for (const part of splitMultipart(raw, boundary)) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd < 0) continue
    const header = part.subarray(0, headerEnd).toString('utf8')
    const dataEnd = part.length >= 2 && part.subarray(part.length - 2).equals(Buffer.from('\r\n'))
      ? part.length - 2
      : part.length
    const data = part.subarray(headerEnd + 4, dataEnd)
    const name = header.match(/Content-Disposition:\s*form-data;[^\r\n]*\bname="([^"]+)"/i)?.[1] || ''
    if (!name) continue
    let filename: string | null
    try {
      filename = parseMultipartFilename(header)
    } catch (error) {
      if (error instanceof MultipartParseError) throw invalid(error.message)
      throw error
    }
    if (name === 'file') {
      if (filename) {
        result.filename = filename
        result.data = data
      }
    } else {
      result.fields[name] = data.toString('utf8')
    }
  }
  return result
}

export async function create(ctx: Context) {
  try {
    const contentType = ctx.get('content-type') || ''
    if (!contentType.startsWith('multipart/form-data')) {
      throw invalid('expected multipart/form-data')
    }
    const raw = await readBodyWithLimit(ctx, svc.getMaxPaperBytes() + MULTIPART_FRAMING_SLACK_BYTES)
    const upload = parseMultipartUpload(contentType, raw)
    if (!upload.data) throw invalid('file field with a PDF document is required')
    const paper = svc.uploadPaper({
      filename: upload.filename || undefined,
      data: upload.data,
      title: upload.fields.title,
      authors: upload.fields.authors,
      year: upload.fields.year,
      venue: upload.fields.venue,
      tags: upload.fields.tags,
    })
    ctx.status = 201
    ctx.body = { paper: svc.paperView(paper) }
  } catch (err) {
    rejectBadRequest(ctx, err)
  }
}

export async function list(ctx: Context) {
  const tag = firstQueryValue(ctx.query.tag as string | string[] | undefined)?.trim() || undefined
  try {
    ctx.body = { papers: svc.listPaperViews({ tag }) }
  } catch (err) {
    rejectBadRequest(ctx, err)
  }
}

export async function get(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const paper = svc.getPaperView(id)
  if (!paper) {
    ctx.status = 404
    ctx.body = { error: 'paper not found' }
    return
  }
  ctx.body = { paper }
}

export async function getByName(ctx: Context) {
  const name = typeof ctx.params?.name === 'string' ? ctx.params.name.trim() : ''
  if (!name) {
    ctx.status = 400
    ctx.body = { error: 'name is required' }
    return
  }
  const paper = svc.getPaperViewByName(name)
  if (!paper) {
    ctx.status = 404
    ctx.body = { error: 'paper not found' }
    return
  }
  ctx.body = { paper }
}

export async function update(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const body = bodyRecord(ctx)
  try {
    const paper = svc.updatePaperMetadata(id, body)
    if (!paper) {
      ctx.status = 404
      ctx.body = { error: 'paper not found' }
      return
    }
    ctx.body = { paper: svc.paperView(paper) }
  } catch (err) {
    rejectBadRequest(ctx, err)
  }
}

export async function remove(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const deleted = svc.deletePaper(id)
  if (!deleted) {
    ctx.status = 404
    ctx.body = { error: 'paper not found' }
    return
  }
  ctx.body = { ok: true }
}

type ByteRange = { start: number; end: number }

/**
 * Parse a single-range `Range` header against a known resource size.
 * Returns null when the header is absent, malformed, or multi-range (serve
 * the whole file), and 'unsatisfiable' when the request cannot be met
 * (respond 416).
 */
function parseRangeHeader(header: string, size: number): ByteRange | null | 'unsatisfiable' {
  const match = /^\s*bytes=(\d*)-(\d*)\s*$/.exec(header)
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    const suffixLength = Number(rawEnd)
    // RFC 7233: a suffix range over a zero-length representation can never
    // be satisfied; without this guard the read stream would open with
    // {start: 0, end: -1} and throw ERR_OUT_OF_RANGE (HTTP 500).
    if (suffixLength === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return null
  return { start, end }
}

function contentDispositionInline(title: string): string {
  const sanitized = title.replace(/[\r\n"]/g, ' ').trim() || 'paper.pdf'
  const filename = sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`
  return `inline; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function streamFile(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const paper = svc.getPaper(id)
  if (!paper) {
    ctx.status = 404
    ctx.body = { error: 'paper not found' }
    return
  }
  await streamPaperFile(ctx, paper)
}

export async function streamFileByName(ctx: Context) {
  const name = typeof ctx.params?.name === 'string' ? ctx.params.name.trim() : ''
  if (!name) {
    ctx.status = 400
    ctx.body = { error: 'name is required' }
    return
  }
  const paper = svc.getPaperByName(name)
  if (!paper) {
    ctx.status = 404
    ctx.body = { error: 'paper not found' }
    return
  }
  await streamPaperFile(ctx, paper)
}

async function streamPaperFile(ctx: Context, paper: PaperRecord): Promise<void> {
  if (!existsSync(paper.file_path)) {
    ctx.status = 404
    ctx.body = { error: 'paper file not found' }
    return
  }
  const size = statSync(paper.file_path).size
  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Content-Type', 'application/pdf')
  ctx.set('Content-Disposition', contentDispositionInline(paper.original_name || paper.title))

  // HEAD must only fill metadata: Koa never consumes the response body for
  // HEAD, so a createReadStream would hold its file descriptor until the next
  // GC pass. The browser PDF viewer probes the size through HEAD before
  // requesting the ranges it needs.
  if (ctx.method === 'HEAD') {
    ctx.status = 200
    ctx.set('Content-Length', String(size))
    return
  }

  const rangeHeader = ctx.get('range')
  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, size)
    if (range === 'unsatisfiable') {
      ctx.status = 416
      ctx.set('Content-Range', `bytes */${size}`)
      ctx.body = null
      return
    }
    if (range) {
      ctx.status = 206
      ctx.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      ctx.length = range.end - range.start + 1
      ctx.body = createReadStream(paper.file_path, { start: range.start, end: range.end })
      return
    }
  }

  ctx.length = size
  ctx.body = createReadStream(paper.file_path)
}
