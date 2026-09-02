// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

const chatApi = vi.hoisted(() => ({
  startRunViaSocket: vi.fn(),
  resumeSession: vi.fn(),
  registerSessionHandlers: vi.fn(),
}))

vi.mock('@/api/studio/chat', () => ({
  startRunViaSocket: chatApi.startRunViaSocket,
  resumeSession: chatApi.resumeSession,
  registerSessionHandlers: chatApi.registerSessionHandlers,
  unregisterSessionHandlers: vi.fn(),
  getChatRunSocket: vi.fn(() => ({ emit: vi.fn() })),
  respondToolApproval: vi.fn(),
  respondClarify: vi.fn(),
  onPeerUserMessage: vi.fn(() => vi.fn()),
  onApprovalRequested: vi.fn(() => vi.fn()),
  onApprovalResolved: vi.fn(() => vi.fn()),
  onClarifyRequested: vi.fn(() => vi.fn()),
  onClarifyResolved: vi.fn(() => vi.fn()),
  onSessionCommand: vi.fn(() => vi.fn()),
  onSessionTitleUpdated: vi.fn(() => vi.fn()),
  onSessionWorkspaceUpdated: vi.fn(() => vi.fn()),
  onSessionSettingsUpdated: vi.fn(() => vi.fn()),
}))

vi.mock('@/api/client', () => ({
  getActiveProfileName: () => 'default',
  hasApiKey: () => false,
}))

vi.mock('@/api/studio/sessions', () => ({
  archiveSession: vi.fn(),
  deleteSession: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessions: vi.fn(async () => []),
  fetchSessionMessagesPage: vi.fn(async () => ({ messages: [], messageTotal: 0 })),
  fetchWorkspaceRunChangesForSession: vi.fn(async () => []),
  fetchWorkspaceRunChangeFile: vi.fn(async () => null),
  setSessionModel: vi.fn(),
  setSessionPushEnabled: vi.fn(),
  setSessionReasoningEffort: vi.fn(),
}))

vi.mock('@/api/studio/download', () => ({
  getDownloadUrl: (_path: string, name: string) => `/download/${name}`,
}))

const knowledgeApi = vi.hoisted(() => ({
  askQuestion: vi.fn(),
  getQuestion: vi.fn(),
}))

vi.mock('@/api/studio/research-knowledge', () => ({
  askQuestion: knowledgeApi.askQuestion,
  getQuestion: knowledgeApi.getQuestion,
}))

const libraryApi = vi.hoisted(() => ({
  listPapers: vi.fn(),
}))

vi.mock('@/api/studio/research-library', () => ({
  listPapers: libraryApi.listPapers,
}))

import { useChatStore } from '@/stores/hermes/chat'

function makeSession(id: string) {
  return {
    id,
    title: id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function questionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    collection_id: 'col-1',
    status: 'queued',
    question: 'What is attention?',
    answer: null,
    citations: [],
    engine: 'paper-qa',
    error: null,
    created_at: 1,
    updated_at: 1,
    finished_at: null,
    ...overrides,
  }
}

const KB = { id: 'col-1', name: 'Transformers' }

describe('chat store knowledge base ask orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useRealTimers()
    setActivePinia(createPinia())
    chatApi.startRunViaSocket.mockReturnValue({ abort: vi.fn() })
    chatApi.resumeSession.mockImplementation((sessionId: string, onResumed: (data: any) => void) => {
      onResumed({ session_id: sessionId, messages: [], isWorking: false, events: [] })
      return {} as any
    })
    chatApi.registerSessionHandlers.mockImplementation(() => vi.fn())
    libraryApi.listPapers.mockResolvedValue([
      { id: 'paper-1', title: 'Attention Is All You Need' },
      { id: 'paper-2', title: 'BERT' },
    ])
  })

  async function mountActiveSession() {
    const store = useChatStore()
    const session = makeSession('session-1')
    store.sessions = [session]
    store.activeSessionId = 'session-1'
    store.activeSession = session
    return store
  }

  it('posts the user message, polls the question, and replies with cited answer', async () => {
    const store = await mountActiveSession()
    knowledgeApi.askQuestion.mockResolvedValue(questionRecord({ status: 'queued' }))
    knowledgeApi.getQuestion
      .mockResolvedValueOnce(questionRecord({ status: 'running' }))
      .mockResolvedValueOnce(questionRecord({
        status: 'answered',
        answer: 'Attention lets networks focus.',
        citations: [
          { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism' },
          { paperId: 'paper-2', page: null, snippet: '' },
        ],
        finished_at: 2,
      }))

    vi.useFakeTimers()
    const done = store.sendKnowledgeBaseMessage(KB, 'What is attention?')
    await flushPromises()

    expect(knowledgeApi.askQuestion).toHaveBeenCalledWith('col-1', 'What is attention?')
    // While the sidecar works, the assistant placeholder renders as loading.
    const pending = store.sessions[0].messages
    expect(pending).toHaveLength(2)
    expect(pending[0]).toMatchObject({ role: 'user', content: 'What is attention?' })
    expect(pending[1]).toMatchObject({ role: 'assistant', isStreaming: true })

    await vi.advanceTimersByTimeAsync(1100)
    await done

    // No agent run may be started for a knowledge base ask.
    expect(chatApi.startRunViaSocket).not.toHaveBeenCalled()

    const messages = store.sessions[0].messages
    expect(messages).toHaveLength(2)
    const answer = messages[1]
    expect(answer.role).toBe('assistant')
    expect(answer.isStreaming).toBe(false)
    expect(answer.content).toBe('Attention lets networks focus.')
    expect(answer.ragCitations).toEqual([
      { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism', title: 'Attention Is All You Need' },
      { paperId: 'paper-2', page: null, snippet: '', title: 'BERT' },
    ])
  })

  it('marks a failed question as an in-chat error without citations', async () => {
    const store = await mountActiveSession()
    knowledgeApi.askQuestion.mockResolvedValue(questionRecord({ status: 'queued' }))
    knowledgeApi.getQuestion.mockResolvedValue(questionRecord({
      status: 'failed',
      error: 'OPENAI_API_KEY is not configured in the server environment',
      finished_at: 2,
    }))

    await store.sendKnowledgeBaseMessage(KB, 'What is attention?')

    const answer = store.sessions[0].messages[1]
    expect(answer.role).toBe('assistant')
    expect(answer.systemType).toBe('error')
    expect(answer.ragAskError).toContain('OPENAI_API_KEY')
    expect(answer.ragCitations).toBeUndefined()
    expect(answer.content).toBe('')
  })

  it('surfaces an ask API failure (unconfigured sidecar / missing key) as an in-chat error', async () => {
    const store = await mountActiveSession()
    knowledgeApi.askQuestion.mockRejectedValue(new Error('API Error 503: the RAG sidecar is not configured'))

    await store.sendKnowledgeBaseMessage(KB, 'What is attention?')

    const answer = store.sessions[0].messages[1]
    expect(answer.systemType).toBe('error')
    expect(answer.ragAskError).toContain('the RAG sidecar is not configured')
  })

  it('falls back to the paper id title when the library cannot be reached', async () => {
    const store = await mountActiveSession()
    libraryApi.listPapers.mockRejectedValue(new Error('library offline'))
    knowledgeApi.askQuestion.mockResolvedValue(questionRecord({ status: 'queued' }))
    knowledgeApi.getQuestion.mockResolvedValue(questionRecord({
      status: 'answered',
      answer: 'Answer body',
      citations: [{ paperId: 'paper-9', page: 1, snippet: 'snippet text' }],
    }))

    await store.sendKnowledgeBaseMessage(KB, 'q')

    const answer = store.sessions[0].messages[1]
    expect(answer.ragCitations).toEqual([
      { paperId: 'paper-9', page: 1, snippet: 'snippet text', title: undefined },
    ])
  })

  it('creates a session when none is active before asking', async () => {
    const store = useChatStore()
    expect(store.sessions).toHaveLength(0)
    knowledgeApi.askQuestion.mockResolvedValue(questionRecord({ status: 'queued' }))
    knowledgeApi.getQuestion.mockResolvedValue(questionRecord({
      status: 'answered',
      answer: 'Answer body',
      citations: [],
    }))

    await store.sendKnowledgeBaseMessage(KB, 'q')

    expect(store.sessions).toHaveLength(1)
    expect(store.activeSessionId).toBe(store.sessions[0].id)
    expect(store.sessions[0].messages[0].content).toBe('q')
    expect(store.sessions[0].messages[1].content).toBe('Answer body')
  })

  it('ignores blank content', async () => {
    const store = await mountActiveSession()
    await store.sendKnowledgeBaseMessage(KB, '   ')
    expect(knowledgeApi.askQuestion).not.toHaveBeenCalled()
    expect(store.sessions[0].messages).toHaveLength(0)
  })
})
