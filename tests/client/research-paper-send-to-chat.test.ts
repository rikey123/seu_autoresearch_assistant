// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { PaperRecord } from '@/api/studio/research-library'

const listPapersMock = vi.hoisted(() => vi.fn())
const uploadPaperMock = vi.hoisted(() => vi.fn())
const deletePaperMock = vi.hoisted(() => vi.fn())
const paperFileUrlMock = vi.hoisted(() =>
  vi.fn((id: string) => `/api/studio/research/library/papers/${id}/file`),
)
const routerPushMock = vi.hoisted(() => vi.fn())
const messageApiMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@/api/studio/research-library', () => ({
  listPapers: listPapersMock,
  uploadPaper: uploadPaperMock,
  deletePaper: deletePaperMock,
  paperFileUrl: paperFileUrlMock,
}))

// Stub of the chat store: the send action must go through the regular chat
// send channel (switchSession + sendMessage) without touching the server.
const chatStoreMock = vi.hoisted(() => {
  const state = {
    sessions: [] as Array<{ id: string; title: string; profile?: string; updatedAt: number }>,
    sessionsLoaded: false,
    loadSessions: vi.fn(async () => {
      state.sessionsLoaded = true
    }),
    switchSession: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
  }
  return state
})

vi.mock('@/stores/hermes/chat', () => ({
  useChatStore: () => ({
    get sessions() {
      return chatStoreMock.sessions
    },
    get sessionsLoaded() {
      return chatStoreMock.sessionsLoaded
    },
    loadSessions: chatStoreMock.loadSessions,
    switchSession: chatStoreMock.switchSession,
    sendMessage: chatStoreMock.sendMessage,
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'name' in params ? `${key}:${params.name}` : key,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'research.papers', params: {} }),
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock('naive-ui', () => ({
  NButton: defineComponent({
    props: ['loading', 'type', 'size', 'quaternary', 'disabled'],
    emits: ['click'],
    template: '<button type="button" :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>',
  }),
  NEmpty: defineComponent({
    props: ['description', 'size'],
    template: '<div class="n-empty-stub">{{ description }}</div>',
  }),
  NModal: defineComponent({
    props: ['show', 'maskClosable'],
    emits: ['update:show'],
    template: '<div v-if="show" class="n-modal-stub"><slot /></div>',
  }),
  NPopconfirm: defineComponent({
    props: ['positiveText', 'negativeText', 'showIcon'],
    emits: ['positive-click'],
    template: `
      <span class="n-popconfirm-stub">
        <slot name="trigger" />
        <button type="button" class="popconfirm-positive" @click="$emit('positive-click')">{{ positiveText }}</button>
      </span>
    `,
  }),
  NSpin: defineComponent({
    props: ['size'],
    template: '<div class="n-spin-stub"><slot /></div>',
  }),
  NTag: defineComponent({
    props: ['size', 'bordered'],
    template: '<span class="n-tag-stub"><slot /></span>',
  }),
  useMessage: () => messageApiMock,
}))

import ResearchPapersView from '@/views/research/ResearchPapersView.vue'
import { buildPaperChatMessage, buildPaperChatMessageForId } from '@/utils/research-artifact-chat'

function paperRecord(overrides: Record<string, unknown> = {}): PaperRecord {
  return {
    id: 'paper-1',
    title: 'Attention Is All You Need',
    original_name: 'attention.pdf',
    authors: ['A. Vaswani'],
    year: 2017,
    venue: 'NeurIPS',
    tags: ['transformers'],
    file_size: 1024,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  } as PaperRecord
}

describe('paper artifact to chat message body', () => {
  it('builds a plain-text reference with title, metadata, tags, and the paper URL', () => {
    const body = buildPaperChatMessageForId(paperRecord())

    expect(body).toContain('📄 Paper: Attention Is All You Need')
    expect(body).toContain('A. Vaswani · 2017 · NeurIPS')
    expect(body).toContain('#transformers')
    expect(body).toContain('File: /api/studio/research/library/papers/paper-1/file')
    // No markdown link syntax: a relative link would render as a dead
    // download card in chat, so the URL stays plain text.
    expect(body).not.toContain('](/api/')
  })

  it('omits empty metadata lines and falls back to the file name for the title', () => {
    const body = buildPaperChatMessage(
      paperRecord({ title: '', authors: [], year: null, venue: '', tags: [] }),
      '/api/studio/research/library/papers/paper-9/file',
    )

    expect(body).toBe('📄 Paper: attention.pdf\nFile: /api/studio/research/library/papers/paper-9/file')
  })
})

describe('send-to-chat action from the paper library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    listPapersMock.mockResolvedValue([paperRecord()])
    chatStoreMock.sessions = [
      { id: 'session-1', title: 'Paper talks', updatedAt: 30 },
      { id: 'session-2', title: 'Scratch', updatedAt: 50 },
    ]
    chatStoreMock.sessionsLoaded = false
    chatStoreMock.loadSessions.mockClear()
    chatStoreMock.switchSession.mockClear()
    chatStoreMock.sendMessage.mockClear()
    chatStoreMock.sendMessage.mockResolvedValue(undefined)
    chatStoreMock.switchSession.mockResolvedValue(undefined)
  })

  async function openModal() {
    const wrapper = mount(ResearchPapersView)
    await flushPromises()
    await wrapper.get('[data-testid="paper-send-to-chat"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('opens the session picker and loads sessions once', async () => {
    const wrapper = await openModal()

    expect(wrapper.find('.n-modal-stub').exists()).toBe(true)
    expect(wrapper.text()).toContain('research.papers.sendToChatTitle')
    expect(chatStoreMock.loadSessions).toHaveBeenCalledTimes(1)
    const options = wrapper.findAll('[data-session-id]')
    expect(options.map(option => option.attributes('data-session-id'))).toEqual(['session-2', 'session-1'])

    wrapper.unmount()
  })

  it('sends the artifact reference into the chosen session via the chat send channel', async () => {
    const wrapper = await openModal()

    await wrapper.get('[data-session-id="session-1"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(chatStoreMock.switchSession).toHaveBeenCalledTimes(1)
    expect(chatStoreMock.switchSession).toHaveBeenCalledWith('session-1')
    expect(chatStoreMock.sendMessage).toHaveBeenCalledTimes(1)
    const body = chatStoreMock.sendMessage.mock.calls[0][0] as string
    expect(body).toContain('📄 Paper: Attention Is All You Need')
    expect(body).toContain('File: /api/studio/research/library/papers/paper-1/file')
    expect(messageApiMock.success).toHaveBeenCalledWith('research.papers.sendToChatSuccess')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'hermes.session',
      params: { sessionId: 'session-1' },
    })
    expect(wrapper.find('.n-modal-stub').exists()).toBe(false)

    wrapper.unmount()
  })

  it('sends into a brand-new chat when the new-session option stays selected', async () => {
    const wrapper = await openModal()

    await wrapper.get('[data-testid="artifact-send-new-session"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(chatStoreMock.switchSession).not.toHaveBeenCalled()
    expect(chatStoreMock.sendMessage).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'hermes.chat' })

    wrapper.unmount()
  })

  it('keeps the modal open and reports a failure when sending fails', async () => {
    const wrapper = await openModal()
    chatStoreMock.sendMessage.mockRejectedValueOnce(new Error('socket down'))

    await wrapper.get('[data-testid="artifact-send-new-session"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(messageApiMock.error).toHaveBeenCalledWith('research.papers.sendToChatFailed')
    expect(messageApiMock.success).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(wrapper.find('.n-modal-stub').exists()).toBe(true)

    wrapper.unmount()
  })

  it('shows the empty state when no sessions exist and still allows a new chat', async () => {
    chatStoreMock.sessions = []
    const wrapper = await openModal()

    expect(wrapper.find('.n-empty-stub').exists()).toBe(true)
    await wrapper.get('[data-testid="artifact-send-new-session"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(chatStoreMock.sendMessage).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'hermes.chat' })

    wrapper.unmount()
  })
})
