// LaTeX compilation (tectonic/latexmk), syntax validation, and templates.
import type { Context } from 'koa'
import Router from '@koa/router'

export const latexRoutes = new Router()

latexRoutes.get('/api/studio/research/latex/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'latex' }
})
