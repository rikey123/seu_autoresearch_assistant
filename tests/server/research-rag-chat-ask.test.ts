// Chat knowledge base ask orchestration: POST /chat-asks persists the user
// question into the chat session's server-side history (real studio SQLite),
// the serial worker appends the cited assistant answer once the sidecar
// question is terminal, and the binding endpoints expose the ids the client
// needs to replace its optimistic messages and hydrate citations.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES_MODULE = '../../packages/server/src/modules/research/rag/index'
const STORE_MODULE = '../../packages/server/src/modules/research/rag/rag-store'
const CHAT_ASK_STORE_MODULE = '../../packages/server/src/modules/research/rag/chat-ask-store'
const SERVICE_MODULE = '../../packages/server/src/modules/research/rag/rag-service'
const PAPER_STORE_MODULE = '../../packages/server/src/modules/research/library/paper-store'
const SESSION_STORE_MODULE = '../../packages/server/src/modules/studio/repositories/session-store'
const DB_INIT_MODULE = '../../packages/server/src/modules/studio/infrastructure/database/schemas'

type RagModule = typeof import('../../packages/server/src/modules/research/rag/index')
type StoreModule = typeof import('../../packages/server/src/modules/research/rag/rag-store')
type ChatAskStoreModule = typeof import('../../packages/server/src/modules/research/rag/chat-ask-store')
type ServiceModule = typeof import('../../packages/server/src/modules/research/rag/rag-service')
type PaperStoreModule = typeof import('../../packages/server/src/modules/research/library/paper-store')
type SessionStoreModule = typeof import('../../packages/server/src/modules/studio/repositories/session-store')

let home = ''
let workDir = ''
let dbDir = ''
let routes: RagModule
let store: StoreModule
let chatAskStore: ChatAskStoreModule
let service: ServiceModule
let paperStore: PaperStoreModule
let sessionStore: SessionStoreModule

const sessionId = 'session-chat-1'

const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
)

/**
 * The same stub sidecar contract used by research-rag.test.ts: RAG_STUB_MODE
 * picks the outcome ('ok' answers with citations, 'fail' reports an error).
 */
function writeStubScript(): string {
  const stubPath = join(workDir, 'rag-sidecar-stub.cjs')
  writeFileSync(stubPath, `const fs = require('fs');
let raw = '';
process.stdin.on('data', function (chunk) { raw += chunk; });
process.stdin.on('end', function () {
  const request = JSON.parse(raw);
  const mode = process.env.RAG_STUB_MODE || 'ok';
  function respond(payload) {
    process.stdout.write(JSON.stringify(payload) + '\\n');
  }
  if (mode === 'fail') {
    respond({ status: 'error', error: 'stub ask failed on purpose' });
    return;
  }
  respond({
    status: 'ok',
    action: 'ask',
    answer: 'Stub answer for: ' + request.question,
    citations: (request.papers || []).map(function (paper, index) {
      return { paperId: paper.id, page: index === 0 ? 4 : null, snippet: 'stub snippet from ' + paper.title };
    }),
    engine: 'stub-engine',
  });
});
`)
  return stubPath
}

async function dispatch(method: string, path: string, body?: Record<string, unknown>, query: Record<string, string> = {}) {
  const dispatchRoute = routes.ragRoutes.routes()
  const ctx: any = {
    method,
    path,
    query,
    params: {},
    header: {},
    request: { body: body ?? undefined },
    state: {},
    status: 200,
    body: undefined,
    set: () => {},
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

async function createIndexedCollection(): Promise<string> {
  const filePath = join(workDir, 'stub.pdf')
  writeFileSync(filePath, PDF_BYTES)
  const paper = paperStore.createPaper({
    title: 'Attention Is All You Need',
    original_name: 'stub.pdf',
    file_path: filePath,
    file_size: PDF_BYTES.length,
  }).id
  const created = await dispatch('POST', '/api/studio/research/rag/collections', { name: 'Transformers' })
  const collectionId = created.body.collection.id
  await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/papers`, { paperId: paper })
  process.env.RAG_STUB_MODE = 'ok'
  const indexed = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
  expect(indexed.status).toBe(202)
  const deadline = Date.now() + 15000
  for (;;) {
    const job = store.getIndexJob(indexed.body.job.id)
    if (job?.status === 'completed') break
    if (job?.status === 'failed') throw new Error(`index failed: ${job.error}`)
    if (Date.now() > deadline) throw new Error('timed out waiting for index')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return collectionId
}

async function waitForQuestion(questionId: string, status: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const record = store.getQuestion(questionId)
    if (record?.status === status) return record
    if (record?.status === 'failed' && status !== 'failed') {
      throw new Error(`question failed while waiting for ${status}: ${record.error}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for question ${questionId} to reach ${status}; last=${JSON.stringify(record)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

beforeEach(async () => {
  vi.resetModules()
  home = mkdtempSync(join(tmpdir(), 'research-chat-ask-home-'))
  workDir = mkdtempSync(join(tmpdir(), 'research-chat-ask-work-'))
  dbDir = mkdtempSync(join(tmpdir(), 'research-chat-ask-db-'))
  process.env.HERMES_WEB_UI_HOME = home
  process.env.HERMES_WEB_UI_TEST_DB_DIR = dbDir
  process.env.OPENAI_API_KEY = 'dummy-rag-key'
  process.env.OPENAI_BASE_URL = 'https://mock.example.invalid/v1'
  process.env.OPENAI_MODEL = 'mock-model'
  process.env.RAG_STUB_MODE = 'ok'
  delete process.env.RAG_SIDECAR_TIMEOUT_MS
  process.env.RAG_SIDECAR_BIN = writeStubScript()
  // Fresh studio session/message tables per test so persistence assertions
  // run against a real, isolated database.
  const dbSchemas = await import(DB_INIT_MODULE)
  dbSchemas.initAllHermesTables()
  paperStore = await import(PAPER_STORE_MODULE)
  store = await import(STORE_MODULE)
  chatAskStore = await import(CHAT_ASK_STORE_MODULE)
  service = await import(SERVICE_MODULE)
  sessionStore = await import(SESSION_STORE_MODULE)
  routes = await import(ROUTES_MODULE)
})

afterEach(async () => {
  service.stopRagWorker()
  await new Promise(resolve => setTimeout(resolve, 150))
  store.closeRagDb()
  paperStore.closePapersDb()
  // Release the studio SQLite handle before deleting the temp dir (Windows
  // keeps deleted-but-open files locked).
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database')
  closeDb()
  for (const key of [
    'HERMES_WEB_UI_HOME',
    'HERMES_WEB_UI_TEST_DB_DIR',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'RAG_STUB_MODE',
    'RAG_SIDECAR_BIN',
    'RAG_SIDECAR_TIMEOUT_MS',
  ]) delete process.env[key]
  rmSync(home, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
  home = ''
  workDir = ''
  dbDir = ''
})

describe('rag chat ask orchestration', () => {
  it('persists the user question, appends the cited answer, and exposes the binding', async () => {
    const collectionId = await createIndexedCollection()
    const sessionId = 'session-chat-1'

    const submitted = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      sessionId,
      collectionId,
      question: 'What is attention?',
      profile: 'default',
    })
    expect(submitted.status).toBe(202)
    const questionId = submitted.body.question.id
    const userMessageId = String(submitted.body.userMessageId)
    expect(userMessageId).toMatch(/^\d+$/)

    // The user question is in the server-side session history immediately.
    const detailAfterSubmit = sessionStore.getSessionDetail(sessionId)
    expect(detailAfterSubmit).not.toBeNull()
    expect(detailAfterSubmit!.messages).toHaveLength(1)
    expect(detailAfterSubmit!.messages[0]).toMatchObject({
      id: Number(userMessageId),
      role: 'user',
      content: 'What is attention?',
    })

    await waitForQuestion(questionId, 'answered')

    // The worker finalizes the binding: the assistant answer lands in the
    // session history and the binding exposes its message id.
    const deadline = Date.now() + 15000
    let askView: any = null
    for (;;) {
      const polled = await dispatch('GET', `/api/studio/research/rag/chat-asks/${questionId}`)
      expect(polled.status).toBe(200)
      if (polled.body.ask.status !== 'pending') {
        askView = polled.body.ask
        break
      }
      if (Date.now() > deadline) throw new Error('timed out waiting for chat ask finalization')
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    expect(askView.status).toBe('answered')
    expect(askView.answer).toBe('Stub answer for: What is attention?')
    expect(askView.assistantMessageId).toMatch(/^\d+$/)
    expect(askView.userMessageId).toBe(userMessageId)
    expect(askView.sessionId).toBe(sessionId)
    expect(askView.citations).toEqual([
      { paperId: expect.any(String), page: 4, snippet: expect.stringContaining('stub snippet') },
    ])

    const detail = sessionStore.getSessionDetail(sessionId)
    expect(detail!.messages).toHaveLength(2)
    expect(detail!.messages[1]).toMatchObject({
      id: Number(askView.assistantMessageId),
      role: 'assistant',
      content: 'Stub answer for: What is attention?',
    })
    // Session stats follow the appended history.
    expect(detail!.message_count).toBe(2)

    // Session listing endpoint returns the same hydrated binding.
    const listed = await dispatch('GET', '/api/studio/research/rag/chat-asks', undefined, { sessionId })
    expect(listed.status).toBe(200)
    expect(listed.body.asks).toHaveLength(1)
    expect(listed.body.asks[0]).toMatchObject({
      questionId,
      status: 'answered',
      assistantMessageId: askView.assistantMessageId,
    })

    // The binding row itself lives in the research-owned store.
    expect(chatAskStore.getChatAsk(questionId)).toMatchObject({
      question_id: questionId,
      session_id: sessionId,
      user_message_id: userMessageId,
      status: 'answered',
    })
  })

  it('creates the server session row when the chat session is still client-only', async () => {
    const collectionId = await createIndexedCollection()

    const submitted = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      sessionId: '20260902_localsession',
      collectionId,
      question: 'Summarize the method.',
    })
    expect(submitted.status).toBe(202)

    const session = sessionStore.getSession('20260902_localsession')
    expect(session).not.toBeNull()
    expect(session!.profile).toBe('default')
    expect(session!.title).toBe('Summarize the method.')
  })

  it('records a failed ask without appending an assistant message', async () => {
    const collectionId = await createIndexedCollection()
    process.env.RAG_STUB_MODE = 'fail'

    const submitted = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      sessionId,
      collectionId,
      question: 'Why does it fail?',
    })
    expect(submitted.status).toBe(202)
    const questionId = submitted.body.question.id
    const userMessageId = String(submitted.body.userMessageId)

    await waitForQuestion(questionId, 'failed')
    const deadline = Date.now() + 15000
    let askView: any = null
    for (;;) {
      const polled = await dispatch('GET', `/api/studio/research/rag/chat-asks/${questionId}`)
      if (polled.body.ask?.status !== 'pending') {
        askView = polled.body.ask
        break
      }
      if (Date.now() > deadline) throw new Error('timed out waiting for failed ask finalization')
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    expect(askView.status).toBe('failed')
    expect(askView.error).toContain('stub ask failed on purpose')
    expect(askView.assistantMessageId).toBeNull()

    // Failure semantics match the pre-persistence behavior: the user message
    // stays in the history, no assistant message is written for the failure.
    const detail = sessionStore.getSessionDetail(sessionId)
    expect(detail!.messages).toHaveLength(1)
    expect(detail!.messages[0].role).toBe('user')
  })

  it('persists nothing when the submission is rejected before enqueue', async () => {
    const missingSession = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      collectionId: 'whatever',
      question: 'q',
    })
    expect(missingSession.status).toBe(400)
    expect(missingSession.body.error).toContain('sessionId is required')

    const missingQuestion = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      sessionId: 'session-x',
      collectionId: 'whatever',
    })
    expect(missingQuestion.status).toBe(400)
    expect(missingQuestion.body.error).toContain('question is required')

    const unknownCollection = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      sessionId: 'session-x',
      collectionId: 'col-missing',
      question: 'q',
    })
    expect(unknownCollection.status).toBe(404)

    // No session row may exist for rejected submissions.
    expect(sessionStore.getSession('session-x')).toBeNull()

    const listed = await dispatch('GET', '/api/studio/research/rag/chat-asks', undefined, { sessionId: 'session-x' })
    expect(listed.status).toBe(200)
    expect(listed.body.asks).toEqual([])
  })

  it('rejects the ask with 503 when the sidecar is not configured, persisting nothing', async () => {
    const collectionId = await createIndexedCollection()
    delete process.env.RAG_SIDECAR_BIN

    const rejected = await dispatch('POST', '/api/studio/research/rag/chat-asks', {
      sessionId,
      collectionId,
      question: 'q',
    })
    expect(rejected.status).toBe(503)
    expect(rejected.body.error).toContain('sidecar is not configured')
    // The user message must not outlive a failed submission.
    expect(sessionStore.getSessionDetail(sessionId)).toBeNull()
    expect(chatAskStore.listSessionChatAsks(sessionId)).toEqual([])
  })

  it('returns 404 for an unknown chat ask id', async () => {
    const missing = await dispatch('GET', '/api/studio/research/rag/chat-asks/no-such-question')
    expect(missing.status).toBe(404)
  })

  it('requires a sessionId on the session listing endpoint', async () => {
    const missing = await dispatch('GET', '/api/studio/research/rag/chat-asks')
    expect(missing.status).toBe(400)
  })
})
