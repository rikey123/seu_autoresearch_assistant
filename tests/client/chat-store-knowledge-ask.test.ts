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
  chatAsk: vi.fn(),
  getChatAsk: vi.fn(),
  listSessionChatAsks: vi.fn(async () => []),
}))

vi.mock('@/api/studio/research-knowledge', () => ({
  chatAsk: knowledgeApi.chatAsk,
  getChatAsk: knowledgeApi.getChatAsk,
  listSessionChatAsks: knowledgeApi.listSessionChatAsks,
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

function chatAskRecord(overrides: Record<string, unknown> = {}) {
  return {
    questionId: 'q-1',
    sessionId: 'session-1',
    status: 'pending',
    userMessageId: '101',
    assistantMessageId: null,
    error: null,
    question: 'What is attention?',
    answer: null,
    citations: [],
    collectionId: 'col-1',
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

  it('posts the user message via chat-ask, adopts server message ids, and replies with cited answer', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk
      .mockResolvedValueOnce(chatAskRecord())
      .mockResolvedValueOnce(chatAskRecord({
        status: 'answered',
        answer: 'Attention lets networks focus.',
        assistantMessageId: '102',
        citations: [
          { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism' },
          { paperId: 'paper-2', page: null, snippet: '' },
        ],
      }))

    vi.useFakeTimers()
    const done = store.sendKnowledgeBaseMessage(KB, 'What is attention?')
    await flushPromises()

    expect(knowledgeApi.chatAsk).toHaveBeenCalledWith('session-1', 'col-1', 'What is attention?', 'default')
    // While the sidecar works, the assistant placeholder renders as loading
    // and the optimistic user message has already adopted its server id.
    const pending = store.sessions[0].messages
    expect(pending).toHaveLength(2)
    expect(pending[0]).toMatchObject({ id: '101', role: 'user', content: 'What is attention?' })
    expect(pending[1]).toMatchObject({ role: 'assistant', isStreaming: true })

    await vi.advanceTimersByTimeAsync(1100)
    await done

    // No agent run may be started for a knowledge base ask.
    expect(chatApi.startRunViaSocket).not.toHaveBeenCalled()

    const messages = store.sessions[0].messages
    expect(messages).toHaveLength(2)
    expect(messages[1].id).toBe('102')
    const answer = messages[1]
    expect(answer.role).toBe('assistant')
    expect(answer.isStreaming).toBe(false)
    expect(answer.content).toBe('Attention lets networks focus.')
    expect(answer.ragCitations).toEqual([
      { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism', title: 'Attention Is All You Need' },
      { paperId: 'paper-2', page: null, snippet: '', title: 'BERT' },
    ])
  })

  it('drops the optimistic copy when a mid-ask reload already brought the server answer', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk.mockImplementation(async () => {
      // Simulate a history reload that replaced the local list with the
      // persisted server rows while the ask is still polling.
      store.sessions[0].messages = [
        { id: '101', role: 'user', content: 'What is attention?', timestamp: Date.now() },
        { id: '102', role: 'assistant', content: 'Attention lets networks focus.', timestamp: Date.now() },
      ]
      return chatAskRecord({
        status: 'answered',
        answer: 'Attention lets networks focus.',
        assistantMessageId: '102',
        citations: [{ paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism' }],
      })
    })

    await store.sendKnowledgeBaseMessage(KB, 'What is attention?')

    const messages = store.sessions[0].messages
    // No duplicates: exactly the two persisted messages remain.
    expect(messages.map(m => m.id)).toEqual(['101', '102'])
    expect(messages[1].ragCitations).toEqual([
      { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism', title: 'Attention Is All You Need' },
    ])
  })

  it('appends the persisted answer as a fresh message when the placeholder vanished mid-ask', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk.mockImplementation(async () => {
      // The reload dropped the local placeholder and the answer was not yet
      // part of the reloaded page.
      store.sessions[0].messages = [
        { id: '101', role: 'user', content: 'What is attention?', timestamp: Date.now() },
      ]
      return chatAskRecord({
        status: 'answered',
        answer: 'Recovered answer.',
        assistantMessageId: '102',
        citations: [],
      })
    })

    await store.sendKnowledgeBaseMessage(KB, 'What is attention?')

    const messages = store.sessions[0].messages
    expect(messages.map(m => m.id)).toEqual(['101', '102'])
    const answer = messages[1]
    expect(answer).toMatchObject({ role: 'assistant', content: 'Recovered answer.' })
    expect(answer.isStreaming).toBeFalsy()
  })

  it('hydrates citations onto the persisted answer after a session reload', async () => {
    const store = await mountActiveSession()
    // Simulate a reload: the resume payload carries the persisted server rows
    // (numeric row ids as strings, timestamps in seconds).
    chatApi.resumeSession.mockImplementation((sessionId: string, onResumed: (data: any) => void) => {
      onResumed({
        session_id: sessionId,
        isWorking: false,
        events: [],
        messages: [
          { id: 101, role: 'user', content: 'What is attention?', timestamp: 1756800000 },
          { id: 102, role: 'assistant', content: 'Attention lets networks focus.', timestamp: 1756800001 },
        ],
      })
      return {} as any
    })
    knowledgeApi.listSessionChatAsks.mockResolvedValue([
      chatAskRecord({
        status: 'answered',
        answer: 'Attention lets networks focus.',
        assistantMessageId: '102',
        citations: [{ paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism' }],
      }),
    ])

    await store.switchSession('session-1')
    await flushPromises()

    expect(knowledgeApi.listSessionChatAsks).toHaveBeenCalledWith('session-1')
    const answer = store.sessions[0].messages[1]
    expect(answer.id).toBe('102')
    expect(answer.ragCitations).toEqual([
      { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism', title: 'Attention Is All You Need' },
    ])
  })

  it('marks a failed question as an in-chat error without citations and without id adoption', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk.mockResolvedValue(chatAskRecord({
      status: 'failed',
      error: 'OPENAI_API_KEY is not configured in the server environment',
    }))

    await store.sendKnowledgeBaseMessage(KB, 'What is attention?')

    const messages = store.sessions[0].messages
    expect(messages).toHaveLength(2)
    // The user message id was adopted (it is persisted server-side), the
    // failed placeholder was not (failures are not persisted).
    expect(messages[0].id).toBe('101')
    const answer = messages[1]
    expect(answer.role).toBe('assistant')
    expect(answer.systemType).toBe('error')
    expect(answer.ragAskError).toContain('OPENAI_API_KEY')
    expect(answer.ragCitations).toBeUndefined()
    expect(answer.content).toBe('')
  })

  it('surfaces a chat-ask API failure (unconfigured sidecar / missing key) as an in-chat error', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockRejectedValue(new Error('API Error 503: the RAG sidecar is not configured'))

    await store.sendKnowledgeBaseMessage(KB, 'What is attention?')

    const answer = store.sessions[0].messages[1]
    expect(answer.systemType).toBe('error')
    expect(answer.ragAskError).toContain('the RAG sidecar is not configured')
  })

  it('falls back to the paper id title when the library cannot be reached', async () => {
    const store = await mountActiveSession()
    libraryApi.listPapers.mockRejectedValue(new Error('library offline'))
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk.mockResolvedValue(chatAskRecord({
      status: 'answered',
      answer: 'Answer body',
      assistantMessageId: '102',
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
    knowledgeApi.chatAsk.mockImplementation(async (sessionId: string) => ({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    }))
    knowledgeApi.getChatAsk.mockResolvedValue(chatAskRecord({
      status: 'answered',
      answer: 'Answer body',
      assistantMessageId: '102',
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
    expect(knowledgeApi.chatAsk).not.toHaveBeenCalled()
    expect(store.sessions[0].messages).toHaveLength(0)
  })

  it('marks the ask as timed out when the polling deadline passes without a terminal record', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk.mockResolvedValue(chatAskRecord())

    vi.useFakeTimers()
    const done = store.sendKnowledgeBaseMessage(KB, 'What is attention?')
    await flushPromises()
    // Advance past the 15 minute KB ask deadline: the poll must converge into
    // the in-chat timeout state instead of polling forever.
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1000)
    await done
    vi.useRealTimers()

    const answer = store.sessions[0].messages[1]
    expect(answer.role).toBe('assistant')
    expect(answer.isStreaming).toBe(false)
    expect(answer.systemType).toBe('error')
    expect(answer.ragAskTimeout).toBe(true)
    expect(answer.ragAskError).toBeUndefined()
    expect(answer.content).toBe('')
  })

  it('recovers from a transient getChatAsk failure instead of failing the whole ask', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(chatAskRecord({
        status: 'answered',
        answer: 'Recovered answer.',
        assistantMessageId: '102',
        citations: [],
      }))

    vi.useFakeTimers()
    const done = store.sendKnowledgeBaseMessage(KB, 'What is attention?')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await done
    vi.useRealTimers()

    const answer = store.sessions[0].messages[1]
    expect(answer.ragAskError).toBeUndefined()
    expect(answer.ragAskTimeout).toBeUndefined()
    expect(answer.isStreaming).toBe(false)
    expect(answer.content).toBe('Recovered answer.')
    // One rejected poll + one successful retry — not a full ask failure.
    expect(knowledgeApi.getChatAsk).toHaveBeenCalledTimes(2)
  })

  it('fails the ask only after getChatAsk keeps failing beyond the retry budget', async () => {
    const store = await mountActiveSession()
    knowledgeApi.chatAsk.mockResolvedValue({
      question: { id: 'q-1', status: 'queued' },
      userMessageId: '101',
    })
    knowledgeApi.getChatAsk.mockRejectedValue(new Error('connection reset'))

    vi.useFakeTimers()
    const done = store.sendKnowledgeBaseMessage(KB, 'What is attention?')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    await done
    vi.useRealTimers()

    const answer = store.sessions[0].messages[1]
    expect(answer.systemType).toBe('error')
    expect(answer.ragAskError).toContain('connection reset')
    expect(answer.ragAskTimeout).toBeUndefined()
  })
})
