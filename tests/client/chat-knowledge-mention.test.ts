// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import { useChatStore } from '@/stores/hermes/chat'
import { useChatKnowledgeStore } from '@/stores/research/chat-knowledge'
import ChatInput from '@/components/hermes/chat/ChatInput.vue'

const fetchSkillsMock = vi.hoisted(() => vi.fn())
const fetchSkillBundlesMock = vi.hoisted(() => vi.fn())
const deleteSkillBundleApiMock = vi.hoisted(() => vi.fn())

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key }),
}))

vi.mock('naive-ui', () => ({
  NButton: { template: '<button type="button" v-bind="$attrs"><slot /><slot name="icon" /></button>' },
  NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
  NSwitch: { template: '<button type="button"></button>' },
  NDropdown: { template: '<div><slot /></div>' },
  NModal: { template: '<div><slot /><slot name="footer" /></div>' },
  NInputNumber: { template: '<input />' },
  NPopover: { template: '<div class="n-popover-stub"><slot name="trigger" /><slot /></div>' },
  NSlider: { props: ['value', 'min', 'max', 'step'], template: '<input class="n-slider-stub" />' },
  useMessage: () => ({ error: vi.fn(), success: vi.fn() }),
  useDialog: () => ({ warning: vi.fn() }),
}))

vi.mock('@/api/studio/sessions', () => ({
  fetchContextLength: vi.fn().mockResolvedValue(256000),
  setSessionReasoningEffort: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/api/hermes/model-context', () => ({
  setModelContext: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/hermes/skills', () => ({
  fetchSkills: fetchSkillsMock,
}))

vi.mock('@/api/hermes/skill-bundles', () => ({
  fetchSkillBundles: fetchSkillBundlesMock,
  deleteSkillBundleApi: deleteSkillBundleApiMock,
}))

vi.mock('@/composables/useToolTraceVisibility', () => ({
  useToolTraceVisibility: () => ({ toolTraceVisible: { value: true }, toggleToolTraceVisible: vi.fn() }),
}))

const knowledgeApi = vi.hoisted(() => ({
  listCollections: vi.fn(),
}))

vi.mock('@/api/studio/research-knowledge', () => ({
  listCollections: knowledgeApi.listCollections,
}))

function collection(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: '',
    index_status: 'indexed',
    chunks: 3,
    engine: 'paper-qa',
    indexed_at: 1,
    created_at: 1,
    updated_at: 1,
    paper_count: 2,
    ...overrides,
  }
}

function mountForSession(sessionId: string) {
  const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn })
  const chatStore = useChatStore()
  const knowledgeStore = useChatKnowledgeStore()
  chatStore.sessions = [
    { id: sessionId, title: sessionId, source: 'cli', messages: [], createdAt: Date.now(), updatedAt: Date.now() },
  ]
  chatStore.activeSessionId = sessionId
  chatStore.activeSession = chatStore.sessions[0]
  return { wrapper: mount(ChatInput, { global: { plugins: [pinia] } }), chatStore, knowledgeStore }
}

async function typeText(wrapper: ReturnType<typeof mount>, text: string, cursor?: number) {
  const input = wrapper.get('textarea')
  input.element.value = text
  const pos = cursor ?? text.length
  input.element.setSelectionRange(pos, pos)
  await input.trigger('input')
  await flushPromises()
}

describe('ChatInput knowledge base @ mention', () => {
  beforeEach(() => {
    localStorage.clear()
    window.innerWidth = 1024
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    fetchSkillsMock.mockReset()
    fetchSkillsMock.mockResolvedValue({ categories: [], archived: [] })
    fetchSkillBundlesMock.mockReset()
    fetchSkillBundlesMock.mockResolvedValue([])
    deleteSkillBundleApiMock.mockReset()
    deleteSkillBundleApiMock.mockResolvedValue(undefined)
    knowledgeApi.listCollections.mockReset()
    knowledgeApi.listCollections.mockResolvedValue([
      collection('col-1', 'Transformers'),
      collection('col-2', 'Diffusion', { index_status: 'unindexed', paper_count: 5 }),
    ])
  })

  it('opens the knowledge base picker when the user types @', async () => {
    const { wrapper } = mountForSession('session-kb')
    await typeText(wrapper as any, '@')

    expect(knowledgeApi.listCollections).toHaveBeenCalledOnce()
    const dropdown = wrapper.find('[data-testid="kb-mention-dropdown"]')
    expect(dropdown.exists()).toBe(true)
    const items = dropdown.findAll('.kb-mention-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('Diffusion')
    expect(items[1].text()).toContain('Transformers')
  })

  it('filters the picker by the text after @ and closes when the query no longer mentions', async () => {
    const { wrapper } = mountForSession('session-kb')
    await typeText(wrapper as any, '@tr')

    const items = wrapper.get('[data-testid="kb-mention-dropdown"]').findAll('.kb-mention-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('Transformers')

    await typeText(wrapper as any, '@tr plus', 4)
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(false)
  })

  it('selecting a knowledge base arms the session, shows the chip, and strips the @query', async () => {
    const { wrapper, knowledgeStore } = mountForSession('session-kb')
    await typeText(wrapper as any, '@tra')

    await wrapper.get('[data-kb-id="col-1"]').trigger('mousedown')
    await nextTick()

    expect(knowledgeStore.selectionBySession['session-kb']).toBe('col-1')
    const chip = wrapper.find('[data-testid="kb-selection-chip"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('Transformers')
    const textarea = wrapper.get('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(false)
  })

  it('keyboard navigation picks the highlighted knowledge base', async () => {
    const { wrapper, knowledgeStore } = mountForSession('session-kb')
    await typeText(wrapper as any, '@')

    const textarea = wrapper.get('textarea')
    // Sorted options: Diffusion (col-2), then Transformers (col-1).
    await textarea.trigger('keydown', { key: 'ArrowDown' })
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(knowledgeStore.selectionBySession['session-kb']).toBe('col-1')
  })

  it('sends text-only messages through the knowledge base ask when armed', async () => {
    const { wrapper, chatStore, knowledgeStore } = mountForSession('session-kb')
    knowledgeStore.collections = [collection('col-1', 'Transformers')]
    knowledgeStore.selectionBySession['session-kb'] = 'col-1'
    const sendKb = vi.spyOn(chatStore, 'sendKnowledgeBaseMessage').mockResolvedValue(undefined)
    const sendMessage = vi.spyOn(chatStore, 'sendMessage').mockResolvedValue(undefined)

    await typeText(wrapper as any, 'What is attention?')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()

    expect(sendKb).toHaveBeenCalledTimes(1)
    expect(sendKb.mock.calls[0][0]).toMatchObject({ id: 'col-1', name: 'Transformers' })
    expect(sendKb.mock.calls[0][1]).toBe('What is attention?')
    expect(sendMessage).not.toHaveBeenCalled()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps attachments on the regular send path even when a knowledge base is armed', async () => {
    const { wrapper, chatStore, knowledgeStore } = mountForSession('session-kb')
    knowledgeStore.collections = [collection('col-1', 'Transformers')]
    knowledgeStore.selectionBySession['session-kb'] = 'col-1'
    const sendKb = vi.spyOn(chatStore, 'sendKnowledgeBaseMessage').mockResolvedValue(undefined)
    const sendMessage = vi.spyOn(chatStore, 'sendMessage').mockResolvedValue(undefined)

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:kb') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await nextTick()

    await typeText(wrapper as any, 'What is attention?')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendKb).not.toHaveBeenCalled()
  })

  it('uses the regular chat send when no knowledge base is armed', async () => {
    const { wrapper, chatStore } = mountForSession('session-kb')
    const sendKb = vi.spyOn(chatStore, 'sendKnowledgeBaseMessage').mockResolvedValue(undefined)
    const sendMessage = vi.spyOn(chatStore, 'sendMessage').mockResolvedValue(undefined)

    await typeText(wrapper as any, 'Hello there')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendKb).not.toHaveBeenCalled()
  })

  it('removing the chip disarms the session', async () => {
    const { wrapper, knowledgeStore } = mountForSession('session-kb')
    knowledgeStore.collections = [collection('col-1', 'Transformers')]
    knowledgeStore.selectForSession('session-kb', 'col-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="kb-selection-chip"]').exists()).toBe(true)
    await wrapper.get('.kb-selection-remove').trigger('click')

    expect(knowledgeStore.selectionBySession['session-kb']).toBeUndefined()
    expect(wrapper.find('[data-testid="kb-selection-chip"]').exists()).toBe(false)
  })

  it('hides the picker when no knowledge bases exist', async () => {
    knowledgeApi.listCollections.mockResolvedValue([])
    const { wrapper } = mountForSession('session-kb')
    await typeText(wrapper as any, '@')
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(false)
  })

  it('refreshes the knowledge base picker when IME composition ends', async () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0)
        return 0
      })
    try {
      const { wrapper } = mountForSession('session-ime')
      const textarea = wrapper.get('textarea')
      const input = textarea.element as HTMLTextAreaElement

      await textarea.trigger('compositionstart')
      input.value = '@'
      input.setSelectionRange(1, 1)
      await textarea.trigger('input')
      await flushPromises()
      // While composing, input events skip mention recomputation, so the
      // picker stays closed even though the text is a valid @ mention.
      expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(false)

      await textarea.trigger('compositionend')
      await flushPromises()

      expect(knowledgeApi.listCollections).toHaveBeenCalled()
      expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(true)
    } finally {
      rafSpy.mockRestore()
    }
  })

  it('does not duplicate the prefix when the cursor moved before the @ before confirming', async () => {
    const { wrapper, knowledgeStore } = mountForSession('session-kb-cursor')
    await typeText(wrapper as any, 'hello @tra')
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(true)

    // Home key / mouse click: move the cursor before the @ while the picker
    // is still open, then confirm with Enter. The stale anchor must not splice
    // slice(0, atPos) + slice(cursorPos) (that would duplicate the prefix).
    const textarea = wrapper.get('textarea')
    ;(textarea.element as HTMLTextAreaElement).setSelectionRange(0, 0)
    await textarea.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(knowledgeStore.selectionBySession['session-kb-cursor']).toBeUndefined()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('hello @tra')
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(false)
  })

  it('closes the picker without inserting when confirming by click with a moved cursor', async () => {
    const { wrapper, knowledgeStore } = mountForSession('session-kb-cursor-click')
    await typeText(wrapper as any, 'hello @tra')
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(true)

    ;(wrapper.get('textarea').element as HTMLTextAreaElement).setSelectionRange(0, 0)
    await wrapper.get('[data-kb-id="col-1"]').trigger('mousedown')
    await flushPromises()

    expect(knowledgeStore.selectionBySession['session-kb-cursor-click']).toBeUndefined()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('hello @tra')
    expect(wrapper.find('[data-testid="kb-mention-dropdown"]').exists()).toBe(false)
  })
})
