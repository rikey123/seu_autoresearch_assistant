// Deterministic research workflow templates: registry endpoints, runs,
// checkpoint resume, and artifact anchors land here step by step.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as templateController from './workflow-template-controller'

export const workflowsRoutes = new Router()

workflowsRoutes.get('/api/studio/research/workflows/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'workflows' }
})

workflowsRoutes.get('/api/studio/research/workflows/templates', templateController.list)
workflowsRoutes.get('/api/studio/research/workflows/templates/:id', templateController.get)
workflowsRoutes.post('/api/studio/research/workflows/templates/:id/validate', templateController.validate)
