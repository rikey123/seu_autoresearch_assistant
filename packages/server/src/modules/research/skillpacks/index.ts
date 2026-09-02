// Research skill packs: curated agent-skill assets installed into the Agent
// skill directories the base mechanism already scans.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as skillpackController from './skillpack-controller'

export const skillpacksRoutes = new Router()

skillpacksRoutes.get('/api/studio/research/skillpacks/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'skillpacks' }
})

skillpacksRoutes.get('/api/studio/research/skillpacks', skillpackController.list)
skillpacksRoutes.get('/api/studio/research/skillpacks/:id', skillpackController.get)
skillpacksRoutes.post('/api/studio/research/skillpacks/:id/load', skillpackController.load)
skillpacksRoutes.post('/api/studio/research/skillpacks/:id/unload', skillpackController.unload)
