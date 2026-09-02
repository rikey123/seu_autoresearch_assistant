// HTTP handlers for the pdf2zh translation queue and bilingual preview.
import type { Context } from 'koa'
import {
  enqueueTranslationJob,
  getTranslationJob,
  getTranslationJobRow,
  listTranslationJobViews,
  openTranslationProductStream,
  retryTranslationJob,
  TranslationJobError,
} from './translation-queue-service'

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function requiredId(ctx: Context): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: 'id is required' }
  return null
}

function rejectJobError(ctx: Context, err: unknown): void {
  const error = err as { status?: number; message?: string }
  ctx.status = typeof error?.status === 'number' ? error.status : 400
  ctx.body = { error: error?.message || 'invalid translation request' }
}

export async function createJob(ctx: Context) {
  try {
    const body = bodyRecord(ctx)
    const job = enqueueTranslationJob({
      pdfPath: String(body.pdfPath || ''),
      targetLang: typeof body.targetLang === 'string' ? body.targetLang : undefined,
      service: typeof body.service === 'string' ? body.service : undefined,
      outDir: typeof body.outDir === 'string' ? body.outDir : undefined,
    })
    ctx.status = 202
    ctx.body = { job }
  } catch (err) {
    rejectJobError(ctx, err)
  }
}

export async function listJobs(ctx: Context) {
  const status = typeof ctx.query?.status === 'string' ? ctx.query.status.trim() : ''
  if (status && !['queued', 'running', 'completed', 'failed'].includes(status)) {
    ctx.status = 400
    ctx.body = { error: 'status must be one of: queued, running, completed, failed' }
    return
  }
  try {
    const jobs = listTranslationJobViews(
      (status || undefined) as 'queued' | 'running' | 'completed' | 'failed' | undefined,
    )
    ctx.body = { jobs }
  } catch (err) {
    rejectJobError(ctx, err)
  }
}

export async function getJob(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const job = getTranslationJob(id)
  if (!job) {
    ctx.status = 404
    ctx.body = { error: 'translation job not found' }
    return
  }
  ctx.body = { job }
}

export async function retryJob(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  try {
    const job = retryTranslationJob(id)
    ctx.body = { job }
  } catch (err) {
    rejectJobError(ctx, err)
  }
}

/**
 * Stream a product PDF (mono = translated, dual = bilingual side-by-side)
 * with single-range HTTP Range support (206) so the client's native PDF
 * renderer can seek without downloading the whole file.
 */
export async function streamProductFile(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const kind = ctx.params?.kind === 'mono' ? 'mono' : ctx.params?.kind === 'dual' ? 'dual' : null
  if (!kind) {
    ctx.status = 400
    ctx.body = { error: 'kind must be "mono" or "dual"' }
    return
  }
  const job = getTranslationJobRow(id)
  if (!job || job.status !== 'completed') {
    ctx.status = 404
    ctx.body = { error: 'translation job not found or not completed' }
    return
  }

  const rangeHeader = Array.isArray(ctx.header?.range)
    ? ctx.header.range[0]
    : ctx.header?.range
  let opened: ReturnType<typeof openTranslationProductStream> = null
  try {
    opened = openTranslationProductStream(job, kind, rangeHeader)
  } catch (err) {
    const error = err as { status?: number; message?: string; size?: number }
    if (error?.status === 416) {
      ctx.status = 416
      ctx.set('Content-Range', `bytes */${typeof error.size === 'number' ? error.size : '*'}`)
      ctx.body = { error: error.message }
      return
    }
    throw err
  }
  if (!opened) {
    ctx.status = 404
    ctx.body = { error: `product file (${kind}) is not available for this job` }
    return
  }

  ctx.status = opened.status
  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Content-Type', 'application/pdf')
  ctx.set('Content-Length', String(opened.end - opened.start + 1))
  if (opened.status === 206) {
    ctx.set('Content-Range', `bytes ${opened.start}-${opened.end}/${opened.size}`)
  }
  ctx.body = opened.stream
}
