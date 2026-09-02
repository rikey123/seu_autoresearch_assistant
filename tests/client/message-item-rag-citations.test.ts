// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({ push: routerPushMock }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('naive-ui', () => ({
  NButton: { template: '<button><slot /></button>' },
  NDrawer: { template: '<div><slot /></div>' },
  NDrawerContent: { template: '<div><slot /></div>' },
  NSpin: { template: '<div />' },
  useMessage: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

import MessageItem from '@/components/hermes/chat/MessageItem.vue'
import type { Message } from '@/stores/hermes/chat'

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    ...overrides,
  }
}

function mountMessage(message: Message) {
  return mount(MessageItem, {
    props: { message },
    global: {
      stubs: {
        MarkdownRenderer: { template: '<div class="markdown-stub">{{ content }}</div>', props: ['content'] },
        ToolChangeCard: { template: '<div />' },
        ProfileAvatar: { template: '<div />' },
        ToolRunCard: { template: '<div />' },
        ToolChangeCardStub: { template: '<div />' },
      },
    },
  })
}

describe('MessageItem knowledge base citation traceability', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    routerPushMock.mockReset()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getVoices: vi.fn(() => []),
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
    })
  })

  it('renders the citation list with resolved titles, pages, and snippets', () => {
    const wrapper = mountMessage(assistantMessage({
      content: 'Attention lets networks focus.',
      ragCitations: [
        { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism', title: 'Attention Is All You Need' },
        { paperId: 'paper-2', page: null, snippet: '', title: undefined },
      ],
    }))

    const citations = wrapper.find('[data-testid="rag-citations"]')
    expect(citations.exists()).toBe(true)
    expect(citations.text()).toContain('research.rag.chatCitationsTitle')

    const first = wrapper.get('[data-testid="rag-citation-0"]')
    expect(first.text()).toContain('Attention Is All You Need')
    expect(first.text()).toContain('research.rag.citationPage')
    expect(first.text()).toContain('We propose a new mechanism')

    const second = wrapper.get('[data-testid="rag-citation-1"]')
    expect(second.text()).toContain('paper-2')
    expect(second.text()).toContain('research.rag.citationPageMissing')
  })

  it('navigates to the paper preview route when a citation is clicked', async () => {
    const wrapper = mountMessage(assistantMessage({
      ragCitations: [
        { paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism', title: 'Attention Is All You Need' },
      ],
    }))

    await wrapper.get('[data-testid="rag-citation-0"]').trigger('click')

    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'research.papers.preview',
      params: { paperId: 'paper-1' },
    })
  })

  it('renders a failed knowledge base ask as a localized in-chat error with detail', () => {
    const wrapper = mountMessage(assistantMessage({
      systemType: 'error',
      ragAskError: 'API Error 503: OPENAI_API_KEY is not configured',
    }))

    const error = wrapper.get('[data-testid="rag-ask-error"]')
    expect(error.text()).toContain('research.rag.chatAskFailed')
    expect(error.text()).toContain('OPENAI_API_KEY')
    expect(wrapper.find('[data-testid="rag-citations"]').exists()).toBe(false)
  })

  it('renders the timeout variant without detail', () => {
    const wrapper = mountMessage(assistantMessage({
      systemType: 'error',
      ragAskTimeout: true,
    }))

    const error = wrapper.get('[data-testid="rag-ask-error"]')
    expect(error.text()).toContain('research.rag.chatAskTimeout')
    expect(error.text()).not.toContain('research.rag.chatAskFailed')
  })

  it('does not render citations or ask errors for plain messages', () => {
    const wrapper = mountMessage(assistantMessage({ content: 'just a normal answer' }))
    expect(wrapper.find('[data-testid="rag-citations"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="rag-ask-error"]').exists()).toBe(false)
  })
})
