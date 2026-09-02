// Deterministic research workflow templates: registry endpoints, runs,
// checkpoint resume, artifact anchors, and the run-file streaming proxy.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as runFileProxy from './run-file-proxy-controller'
import * as templateController from './workflow-template-controller'

export const workflowsRoutes = new Router()

workflowsRoutes.get('/api/studio/research/workflows/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'workflows' }
})

workflowsRoutes.get('/api/studio/research/workflows/templates', templateController.list)
workflowsRoutes.get('/api/studio/research/workflows/templates/:id', templateController.get)
workflowsRoutes.post('/api/studio/research/workflows/templates/:id/validate', templateController.validate)

// Run-file proxy: streams workflow-run PDFs (paper-translate bilingual page)
// with single-range Range support so the comparison page works from http
// origins where file:/// iframes are blocked. HEAD advertises streaming
// metadata without opening a read stream. Registered before any proxy
// catch-all route (hard rule).
workflowsRoutes.get('/api/studio/research/run-files', runFileProxy.stream)
workflowsRoutes.head('/api/studio/research/run-files', runFileProxy.stream)
