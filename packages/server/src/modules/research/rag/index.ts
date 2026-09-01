// paper-qa bridge: library management, indexing, and cited question answering.
import type { Context } from 'koa'
import Router from '@koa/router'

export const ragRoutes = new Router()

ragRoutes.get('/api/studio/research/rag/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'rag' }
})
