// Artifact registry: versions, preview types, and chat references.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as ctrl from './artifact-controller'

export const artifactsRoutes = new Router()

artifactsRoutes.get('/api/studio/research/artifacts/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'artifacts' }
})
artifactsRoutes.get('/api/studio/research/artifacts', ctrl.list)
artifactsRoutes.post('/api/studio/research/artifacts', ctrl.create)
artifactsRoutes.get('/api/studio/research/artifacts/:id', ctrl.get)
artifactsRoutes.get('/api/studio/research/artifacts/:id/preview', ctrl.getPreview)
