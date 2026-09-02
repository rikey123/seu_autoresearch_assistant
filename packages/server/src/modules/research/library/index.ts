// Paper library: PDF intake, metadata, and range-streamed preview for the
// browser's native PDF viewer, plus pdf2zh translation jobs.
import Router from '@koa/router'
import * as paper from './paper-controller'
import * as translations from './translation-queue-controller'

export const libraryRoutes = new Router()

libraryRoutes.get('/api/studio/research/library/health', (ctx) => {
  ctx.body = { ok: true, subdomain: 'library' }
})
libraryRoutes.post('/api/studio/research/library/papers', paper.create)
libraryRoutes.get('/api/studio/research/library/papers', paper.list)
libraryRoutes.get('/api/studio/research/library/papers/by-name/:name', paper.getByName)
// Streaming endpoints: single HTTP byte ranges let the browser's native PDF
// viewer fetch only the chunks it needs, so large PDFs open progressively.
libraryRoutes.get('/api/studio/research/library/papers/by-name/:name/file', paper.streamFileByName)
libraryRoutes.get('/api/studio/research/library/papers/:id', paper.get)
libraryRoutes.patch('/api/studio/research/library/papers/:id', paper.update)
libraryRoutes.del('/api/studio/research/library/papers/:id', paper.remove)
libraryRoutes.get('/api/studio/research/library/papers/:id/file', paper.streamFile)
libraryRoutes.head('/api/studio/research/library/papers/:id/file', paper.streamFile)

// pdf2zh translation queue
libraryRoutes.post('/api/studio/research/library/translations', translations.createJob)
libraryRoutes.get('/api/studio/research/library/translations', translations.listJobs)
libraryRoutes.get('/api/studio/research/library/translations/:id', translations.getJob)
libraryRoutes.post('/api/studio/research/library/translations/:id/retry', translations.retryJob)
libraryRoutes.get('/api/studio/research/library/translations/:id/files/:kind', translations.streamProductFile)
