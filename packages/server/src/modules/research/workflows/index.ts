// Deterministic research workflow templates, runs, checkpoint resume, and artifact anchors.
import type { Context } from 'koa'
import Router from '@koa/router'

export const workflowsRoutes = new Router()

workflowsRoutes.get('/api/studio/research/workflows/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'workflows' }
})
