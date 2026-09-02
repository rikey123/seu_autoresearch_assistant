// LaTeX authoring: document storage, tectonic compilation, and PDF output.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as ctrl from './latex-controller'

export const latexRoutes = new Router()

latexRoutes.get('/api/studio/research/latex/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'latex' }
})

latexRoutes.get('/api/studio/research/latex/engine', ctrl.engine)

latexRoutes.get('/api/studio/research/latex/documents', ctrl.list)
latexRoutes.post('/api/studio/research/latex/documents', ctrl.create)
latexRoutes.get('/api/studio/research/latex/documents/:id', ctrl.get)
latexRoutes.patch('/api/studio/research/latex/documents/:id', ctrl.update)
latexRoutes.delete('/api/studio/research/latex/documents/:id', ctrl.remove)

latexRoutes.post('/api/studio/research/latex/documents/:id/compile', ctrl.compile)
latexRoutes.get('/api/studio/research/latex/documents/:id/compilations/latest', ctrl.latestCompilation)
latexRoutes.get('/api/studio/research/latex/documents/:id/compilations', ctrl.listDocumentCompilations)

latexRoutes.get('/api/studio/research/latex/compilations/:id', ctrl.getCompilationStatus)
latexRoutes.get('/api/studio/research/latex/compilations/:id/pdf', ctrl.getCompilationPdf)
