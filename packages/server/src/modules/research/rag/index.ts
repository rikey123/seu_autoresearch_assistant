// paper-qa bridge: knowledge base (collection) management, PDF indexing, and
// cited question answering through the JSON sidecar subprocess.
import type { Context } from 'koa'
import Router from '@koa/router'
import * as ctrl from './rag-controller'

export const ragRoutes = new Router()

ragRoutes.get('/api/studio/research/rag/health', (ctx: Context) => {
  ctx.body = { ok: true, subdomain: 'rag' }
})

// Collection CRUD
ragRoutes.post('/api/studio/research/rag/collections', ctrl.create)
ragRoutes.get('/api/studio/research/rag/collections', ctrl.list)
ragRoutes.get('/api/studio/research/rag/collections/:id', ctrl.get)
ragRoutes.patch('/api/studio/research/rag/collections/:id', ctrl.update)
ragRoutes.del('/api/studio/research/rag/collections/:id', ctrl.remove)

// Membership (paper ids referencing the T3.1 paper library)
ragRoutes.get('/api/studio/research/rag/collections/:id/papers', ctrl.listMembers)
ragRoutes.post('/api/studio/research/rag/collections/:id/papers', ctrl.addPaper)
ragRoutes.del('/api/studio/research/rag/collections/:id/papers/:paperId', ctrl.removePaper)

// Index lifecycle
ragRoutes.post('/api/studio/research/rag/collections/:id/index', ctrl.index)
ragRoutes.get('/api/studio/research/rag/collections/:id/index', ctrl.latestIndexJob)
ragRoutes.get('/api/studio/research/rag/index-jobs/:jobId', ctrl.indexJobStatus)

// Cited Q&A and per-collection history
ragRoutes.post('/api/studio/research/rag/collections/:id/ask', ctrl.ask)
ragRoutes.get('/api/studio/research/rag/collections/:id/history', ctrl.history)
ragRoutes.get('/api/studio/research/rag/questions/:questionId', ctrl.questionStatus)

// Chat-side knowledge base asks: persist the user question and the cited
// answer into the chat session's server-side history (bindings in rag.db,
// session history writes through the Studio public sessions facade).
ragRoutes.post('/api/studio/research/rag/chat-asks', ctrl.chatAsk)
ragRoutes.get('/api/studio/research/rag/chat-asks', ctrl.sessionChatAsks)
ragRoutes.get('/api/studio/research/rag/chat-asks/:questionId', ctrl.chatAskStatus)
