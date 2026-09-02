// Paper library: PDF intake, metadata, and pdf2zh translation jobs.
import Router from '@koa/router'
import * as ctrl from './translation-queue-controller'

export const libraryRoutes = new Router()

libraryRoutes.get('/api/studio/research/library/health', (ctx) => {
  ctx.body = { ok: true, subdomain: 'library' }
})

// pdf2zh translation queue
libraryRoutes.post('/api/studio/research/library/translations', ctrl.createJob)
libraryRoutes.get('/api/studio/research/library/translations', ctrl.listJobs)
libraryRoutes.get('/api/studio/research/library/translations/:id', ctrl.getJob)
libraryRoutes.post('/api/studio/research/library/translations/:id/retry', ctrl.retryJob)
libraryRoutes.get('/api/studio/research/library/translations/:id/files/:kind', ctrl.streamProductFile)
