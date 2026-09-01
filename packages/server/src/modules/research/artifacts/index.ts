// Artifact registry: versions, preview types, and chat references.
import type { Context } from 'koa'
import Router from '@koa/router'

export const artifactsRoutes = new Router()

artifactsRoutes.get('/api/studio/research/artifacts/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'artifacts' }
})
