// Paper library: PDF intake, metadata, and pdf2zh translation jobs.
import type { Context } from 'koa'
import Router from '@koa/router'

export const libraryRoutes = new Router()

libraryRoutes.get('/api/studio/research/library/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'library' }
})
