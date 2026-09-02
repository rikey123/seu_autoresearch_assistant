// HTTP handlers for the LaTeX document and compilation endpoints.
import { createReadStream, statSync } from 'node:fs'
import type { Context } from 'koa'
import {
  LatexServiceError,
  createLatexDocument,
  deleteLatexDocument,
  getCompletedPdfPath,
  getEngineInfo,
  getLatexCompilation,
  getLatexDocument,
  getLatestCompilation,
  listCompilations,
  listLatexDocuments,
  requestCompilation,
  updateLatexDocument,
} from './latex-service'

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function requiredId(ctx: Context, kind: 'document' | 'compilation'): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: `${kind} id is required`, code: 'invalid_request' }
  return null
}

function respondError(ctx: Context, err: unknown): void {
  const error = err as LatexServiceError
  ctx.status = typeof error?.status === 'number' ? error.status : 400
  ctx.body = {
    error: error?.message || 'invalid latex request',
    code: error instanceof LatexServiceError ? error.code : 'invalid_request',
  }
}

export async function engine(ctx: Context) {
  ctx.body = { engine: getEngineInfo() }
}

export async function create(ctx: Context) {
  try {
    const document = createLatexDocument(bodyRecord(ctx))
    ctx.status = 201
    ctx.body = { document }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function list(ctx: Context) {
  ctx.body = { documents: listLatexDocuments() }
}

export async function get(ctx: Context) {
  const id = requiredId(ctx, 'document')
  if (!id) return
  try {
    ctx.body = { document: getLatexDocument(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function update(ctx: Context) {
  const id = requiredId(ctx, 'document')
  if (!id) return
  try {
    const document = updateLatexDocument(id, bodyRecord(ctx))
    ctx.body = { document }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function remove(ctx: Context) {
  const id = requiredId(ctx, 'document')
  if (!id) return
  try {
    deleteLatexDocument(id)
    ctx.body = { ok: true }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function compile(ctx: Context) {
  const id = requiredId(ctx, 'document')
  if (!id) return
  try {
    const compilation = requestCompilation(id)
    ctx.status = 202
    ctx.body = { compilation }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function latestCompilation(ctx: Context) {
  const id = requiredId(ctx, 'document')
  if (!id) return
  try {
    ctx.body = { compilation: getLatestCompilation(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function listDocumentCompilations(ctx: Context) {
  const id = requiredId(ctx, 'document')
  if (!id) return
  const status = firstQueryValue(ctx.query.status as string | string[] | undefined)?.trim() || undefined
  try {
    ctx.body = { compilations: listCompilations(id, status) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function getCompilationStatus(ctx: Context) {
  const id = requiredId(ctx, 'compilation')
  if (!id) return
  try {
    ctx.body = { compilation: getLatexCompilation(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function getCompilationPdf(ctx: Context) {
  const id = requiredId(ctx, 'compilation')
  if (!id) return
  let pdfPath: string
  try {
    pdfPath = getCompletedPdfPath(id)
  } catch (err) {
    respondError(ctx, err)
    return
  }
  ctx.type = 'application/pdf'
  ctx.length = statSync(pdfPath).size
  const stream = createReadStream(pdfPath)
  // The stream opens lazily; if the file vanishes between the existsSync
  // check and that open, the failure is unactionable once streaming began.
  stream.on('error', () => stream.destroy())
  ctx.body = stream
}
