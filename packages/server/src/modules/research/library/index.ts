// Paper library: PDF intake, metadata, and range-streamed preview for the
// browser's native PDF viewer.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as ctrl from './paper-controller'

export const libraryRoutes = new Router()

libraryRoutes.get('/api/studio/research/library/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'library' }
})
libraryRoutes.post('/api/studio/research/library/papers', ctrl.create)
libraryRoutes.get('/api/studio/research/library/papers', ctrl.list)
libraryRoutes.get('/api/studio/research/library/papers/by-name/:name', ctrl.getByName)
// Streaming endpoints: single HTTP byte ranges let the browser's native PDF
// viewer fetch only the chunks it needs, so large PDFs open progressively.
libraryRoutes.get('/api/studio/research/library/papers/by-name/:name/file', ctrl.streamFileByName)
libraryRoutes.get('/api/studio/research/library/papers/:id', ctrl.get)
libraryRoutes.patch('/api/studio/research/library/papers/:id', ctrl.update)
libraryRoutes.del('/api/studio/research/library/papers/:id', ctrl.remove)
libraryRoutes.get('/api/studio/research/library/papers/:id/file', ctrl.streamFile)
libraryRoutes.head('/api/studio/research/library/papers/:id/file', ctrl.streamFile)
