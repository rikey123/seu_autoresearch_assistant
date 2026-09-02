// HTTP handler for the research run-file proxy endpoint. This controller is
// deliberately thin: confinement and range opening live in the service.
import type { Context } from 'koa'
import { openRunFileStream, RunFileProxyError } from './run-file-proxy-service'

function firstQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function safeAsciiFileName(fileName: string): string {
  return fileName.replace(/[\x00-\x1f\x7f]/g, '_').replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'file'
}

function inlineDisposition(fileName: string): string {
  return `inline; filename="${safeAsciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * GET/HEAD /api/studio/research/run-files?path=<absolute path>
 *
 * Streams a research-run PDF (paper-translate mono/dual products) with
 * single-range HTTP Range support so the browser's native PDF viewer can
 * seek inside iframes on http origins, where the legacy file:/// embed is
 * blocked. The request still passes the global auth middleware, and the
 * generated bilingual page authenticates with the repo-standard `?token=`
 * query parameter (the same pattern as the Studio download routes).
 */
export async function stream(ctx: Context) {
  const requested = firstQueryValue(ctx.query?.path)
  if (!requested.trim()) {
    ctx.status = 400
    ctx.body = { error: 'path query parameter is required' }
    return
  }

  const rangeHeader = ctx.get('range') || undefined
  // HEAD must only fill metadata: Koa never consumes the response body for
  // HEAD, so a createReadStream would hold its file descriptor until the
  // next GC pass. The browser PDF viewer probes the size through HEAD
  // before requesting the ranges it needs.
  const headOnly = ctx.method === 'HEAD'

  let opened
  try {
    opened = openRunFileStream(requested, rangeHeader, !headOnly)
  } catch (err) {
    if (err instanceof RunFileProxyError) {
      // The service throws 400/403/404; unsatisfiable ranges come back as a
      // normal result and are answered 416 below (mirroring the library
      // streaming endpoints).
      ctx.status = err.status
      ctx.body = { error: err.message }
      return
    }
    throw err
  }

  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Content-Type', 'application/pdf')
  ctx.set('Content-Disposition', inlineDisposition(opened.fileName))
  ctx.set('Cache-Control', 'no-store, max-age=0')
  ctx.set('X-Content-Type-Options', 'nosniff')

  if (opened.unsatisfiable) {
    ctx.status = 416
    ctx.set('Content-Range', `bytes */${opened.size}`)
    return
  }

  if (opened.range) {
    ctx.status = 206
    ctx.set('Content-Range', `bytes ${opened.range.start}-${opened.range.end}/${opened.size}`)
    ctx.set('Content-Length', String(opened.range.end - opened.range.start + 1))
    if (!headOnly) ctx.body = opened.stream
    return
  }

  ctx.status = 200
  ctx.set('Content-Length', String(opened.size))
  if (!headOnly) ctx.body = opened.stream
}
