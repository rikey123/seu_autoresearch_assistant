// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ArtifactRecord } from '@/api/studio/research-artifacts'

const listArtifactsMock = vi.hoisted(() => vi.fn())
const getArtifactMock = vi.hoisted(() => vi.fn())
const getArtifactPreviewMock = vi.hoisted(() => vi.fn())
const artifactPreviewPathMock = vi.hoisted(() =>
  vi.fn((id: string) => `/api/studio/research/artifacts/${id}/preview`),
)
const deleteArtifactMock = vi.hoisted(() => vi.fn())
const routerPushMock = vi.hoisted(() => vi.fn())
const messageApiMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@/api/studio/research-artifacts', () => ({
  ARTIFACT_TYPES: ['html', 'svg', 'pptx', 'drawio', 'pdf', 'latex', 'figure'],
  listArtifacts: listArtifactsMock,
  getArtifact: getArtifactMock,
  getArtifactPreview: getArtifactPreviewMock,
  artifactPreviewPath: artifactPreviewPathMock,
  deleteArtifact: deleteArtifactMock,
}))

// The shared artifact-chat util imports paperFilePath from the library API,
// whose module chain pulls in the real router; stub it out here.
vi.mock('@/api/studio/research-library', () => ({
  paperFilePath: vi.fn((id: string) => `/api/studio/research/library/papers/${id}/file`),
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
  useRoute: () => ({ name: 'research.artifacts', params: {} }),
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
  NInput: defineComponent({
    props: ['value', 'placeholder', 'clearable', 'size'],
    emits: ['update:value'],
    template: '<input class="n-input-stub" :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />',
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
  NSelect: defineComponent({
    props: ['value', 'options', 'placeholder', 'loading', 'clearable', 'size'],
    emits: ['update:value'],
    template: '<select class="n-select-stub" @change="$emit(\'update:value\', $event.target.value)">'
      + '<option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>'
      + '</select>',
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

import ResearchArtifactsView from '@/views/research/ResearchArtifactsView.vue'
import enLocale from '../../packages/client/src/i18n/locales/en'
import zhLocale from '../../packages/client/src/i18n/locales/zh'
import zhTwLocale from '../../packages/client/src/i18n/locales/zh-TW'
import arLocale from '../../packages/client/src/i18n/locales/ar'
import deLocale from '../../packages/client/src/i18n/locales/de'
import esLocale from '../../packages/client/src/i18n/locales/es'
import frLocale from '../../packages/client/src/i18n/locales/fr'
import jaLocale from '../../packages/client/src/i18n/locales/ja'
import koLocale from '../../packages/client/src/i18n/locales/ko'
import ptLocale from '../../packages/client/src/i18n/locales/pt'
import ruLocale from '../../packages/client/src/i18n/locales/ru'

function artifactRecord(overrides: Record<string, unknown> = {}): ArtifactRecord {
  return {
    id: 'artifact-1',
    project_id: null,
    type: 'pdf',
    title: 'Compiled paper (compiled PDF)',
    version: 1,
    source_run_id: null,
    preview: { documentId: 'doc-1', compilationId: 'comp-1', byteSize: 2048 },
    created_at: 1735689600000,
    updated_at: 1767225600000,
    ...overrides,
  } as ArtifactRecord
}

const pdfArtifact = artifactRecord({
  id: 'artifact-pdf',
  source_run_id: 'run-9',
  preview: { documentId: 'doc-1', byteSize: 2048 },
})
const htmlArtifact = artifactRecord({
  id: 'artifact-html',
  type: 'html',
  title: 'Bilingual report',
  version: 2,
  source_run_id: null,
  preview: { html: '<p><b>Hello</b> report</p>', pages: 3 },
})

describe('research artifacts view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    listArtifactsMock.mockResolvedValue([pdfArtifact, htmlArtifact])
    deleteArtifactMock.mockResolvedValue(undefined)
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

  async function mountView() {
    const wrapper = mount(ResearchArtifactsView)
    await flushPromises()
    return wrapper
  }

  it('renders artifact rows with name, type, source, version, and time', async () => {
    const wrapper = await mountView()

    expect(listArtifactsMock).toHaveBeenCalledWith(undefined)
    const items = wrapper.findAll('li.artifact-item')
    expect(items).toHaveLength(2)

    const text = wrapper.text()
    expect(text).toContain('Compiled paper (compiled PDF)')
    expect(text).toContain('Bilingual report')
    expect(text).toContain('research.artifacts.typeLabels.pdf')
    expect(text).toContain('research.artifacts.typeLabels.html')
    expect(wrapper.find('[data-testid="artifact-source-artifact-pdf"]').text()).toBe('run-9')
    expect(wrapper.find('[data-testid="artifact-source-artifact-html"]').text()).toContain(
      'research.artifacts.sourceNone',
    )
    expect(text).toContain('v1')
    expect(text).toContain('v2')
    expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)

    wrapper.unmount()
  })

  it('passes the type filter to the server list call and back to all', async () => {
    const wrapper = await mountView()

    await wrapper.get('select.n-select-stub').setValue('svg')
    await flushPromises()
    expect(listArtifactsMock).toHaveBeenLastCalledWith('svg')

    await wrapper.get('select.n-select-stub').setValue('')
    await flushPromises()
    expect(listArtifactsMock).toHaveBeenLastCalledWith(undefined)

    wrapper.unmount()
  })

  it('filters by keyword client-side without refetching', async () => {
    const wrapper = await mountView()
    const callsAfterLoad = listArtifactsMock.mock.calls.length

    await wrapper.get('input.n-input-stub').setValue('bilingual')
    await flushPromises()

    const items = wrapper.findAll('li.artifact-item')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('Bilingual report')
    expect(listArtifactsMock.mock.calls.length).toBe(callsAfterLoad)

    wrapper.unmount()
  })

  it('shows the guided empty state when the registry has no artifacts', async () => {
    listArtifactsMock.mockResolvedValue([])
    const wrapper = await mountView()

    const empty = wrapper.get('[data-testid="artifacts-empty"]')
    expect(empty.text()).toContain('research.artifacts.empty')

    wrapper.unmount()
  })

  it('shows the filtered empty state when no artifact matches the keyword', async () => {
    const wrapper = await mountView()

    await wrapper.get('input.n-input-stub').setValue('no-such-artifact')
    await flushPromises()

    expect(wrapper.get('[data-testid="artifacts-filtered-empty"]').text()).toContain(
      'research.artifacts.emptyFiltered',
    )

    wrapper.unmount()
  })

  it('opens the inline preview modal with metadata for registry-only artifacts', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="artifact-preview"]').trigger('click')
    await flushPromises()

    const modal = wrapper.get('.artifact-preview-modal')
    expect(modal.text()).toContain('Compiled paper (compiled PDF)')
    expect(wrapper.get('[data-testid="artifact-preview-summary"]').text()).toContain('documentId: doc-1')
    expect(wrapper.find('iframe.preview-frame').exists()).toBe(false)

    wrapper.unmount()
  })

  it('embeds inline HTML artifacts in a sandboxed iframe and offers a new window', async () => {
    const createObjectURLMock = vi.fn(() => 'blob:mock-preview-url')
    const revokeObjectURLMock = vi.fn()
    // jsdom implements neither; the view uses blob URLs for the new-window
    // escape hatch of inline HTML previews.
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURLMock, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURLMock, configurable: true, writable: true })
    const openMock = vi.spyOn(window, 'open').mockReturnValue(null)

    const wrapper = await mountView()
    const items = wrapper.findAll('li.artifact-item')
    await items[1].get('[data-testid="artifact-preview"]').trigger('click')
    await flushPromises()

    const frame = wrapper.get('iframe.preview-frame')
    expect(frame.attributes('sandbox')).toBe('')
    expect(frame.attributes('srcdoc')).toContain('<p><b>Hello</b> report</p>')

    await wrapper.get('[data-testid="artifact-open-new-window"]').trigger('click')
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock.mock.calls[0][0]).toBe('blob:mock-preview-url')
    expect(openMock.mock.calls[0][1]).toBe('_blank')

    openMock.mockRestore()
    wrapper.unmount()
    delete (URL as { createObjectURL?: unknown }).createObjectURL
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
  })

  it('deletes an artifact after confirmation and refreshes the local list', async () => {
    const wrapper = await mountView()

    const items = wrapper.findAll('li.artifact-item')
    expect(items).toHaveLength(2)
    await items[0].get('[data-testid="artifact-delete"]').trigger('click')
    await items[0].get('.popconfirm-positive').trigger('click')
    await flushPromises()

    expect(deleteArtifactMock).toHaveBeenCalledTimes(1)
    expect(deleteArtifactMock).toHaveBeenCalledWith('artifact-pdf')
    expect(wrapper.findAll('li.artifact-item')).toHaveLength(1)
    // Deletion feedback flows through the store notice, like the paper library.
    expect(wrapper.get('[role="alert"]').text()).toBe('research.artifacts.deleteSuccess')

    wrapper.unmount()
  })

  it('reports a failure and keeps the row when deletion fails', async () => {
    deleteArtifactMock.mockRejectedValueOnce(new Error('server down'))
    const wrapper = await mountView()

    const items = wrapper.findAll('li.artifact-item')
    await items[0].get('[data-testid="artifact-delete"]').trigger('click')
    await items[0].get('.popconfirm-positive').trigger('click')
    await flushPromises()

    expect(messageApiMock.success).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe('research.artifacts.deleteFailed')
    expect(wrapper.findAll('li.artifact-item')).toHaveLength(2)

    wrapper.unmount()
  })

  async function openSendModal() {
    const wrapper = await mountView()
    await wrapper.get('[data-testid="artifact-send-to-chat"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('sends the artifact reference into the chosen session via the chat send channel', async () => {
    const wrapper = await openSendModal()

    expect(wrapper.find('.artifact-send-modal').exists()).toBe(true)
    expect(chatStoreMock.loadSessions).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-session-id="session-1"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(chatStoreMock.switchSession).toHaveBeenCalledWith('session-1')
    expect(chatStoreMock.sendMessage).toHaveBeenCalledTimes(1)
    const body = chatStoreMock.sendMessage.mock.calls[0][0] as string
    expect(body).toContain('📄 Artifact: Compiled paper (compiled PDF)')
    expect(body).toContain('pdf · v1 · run: run-9')
    expect(body).toContain('documentId: doc-1')
    expect(messageApiMock.success).toHaveBeenCalledWith('research.artifacts.sendToChatSuccess')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'hermes.session',
      params: { sessionId: 'session-1' },
    })
    expect(wrapper.find('.artifact-send-modal').exists()).toBe(false)

    wrapper.unmount()
  })

  it('sends into a brand-new chat when the new-session option stays selected', async () => {
    const wrapper = await openSendModal()

    await wrapper.get('[data-testid="artifact-send-new-session"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(chatStoreMock.switchSession).not.toHaveBeenCalled()
    expect(chatStoreMock.sendMessage).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'hermes.chat' })

    wrapper.unmount()
  })

  it('keeps the modal open and reports a failure when sending fails', async () => {
    chatStoreMock.sendMessage.mockRejectedValueOnce(new Error('socket down'))
    const wrapper = await openSendModal()

    await wrapper.get('[data-testid="artifact-send-new-session"]').trigger('click')
    await wrapper.get('[data-testid="artifact-send-confirm"]').trigger('click')
    await flushPromises()

    expect(messageApiMock.error).toHaveBeenCalledWith('research.artifacts.sendToChatFailed')
    expect(messageApiMock.success).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()
    expect(wrapper.find('.artifact-send-modal').exists()).toBe(true)

    wrapper.unmount()
  })
})

describe('research.artifacts locale coverage', () => {
  const localeMessages: Record<string, Record<string, unknown>> = {
    en: enLocale, zh: zhLocale, 'zh-TW': zhTwLocale, ar: arLocale, de: deLocale,
    es: esLocale, fr: frLocale, ja: jaLocale, ko: koLocale, pt: ptLocale, ru: ruLocale,
  }

  function collectLeafPaths(value: unknown, prefix: string): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => collectLeafPaths(child, `${prefix}.${key}`))
      .sort()
  }

  it('defines the research.artifacts block with the english key set in all 11 locales', () => {
    const englishPaths = collectLeafPaths((enLocale.research as any).artifacts, 'research.artifacts')
    expect(englishPaths.length).toBeGreaterThan(20)
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const paths = collectLeafPaths((messages.research as any).artifacts, 'research.artifacts')
      expect(paths, `${locale} research.artifacts keys`).toEqual(englishPaths)
    }
  })

  it('carries non-empty translated strings and the type labels everywhere', () => {
    const expectedTypes = ['html', 'svg', 'pptx', 'drawio', 'pdf', 'latex', 'figure']
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const block = (messages.research as any).artifacts
      for (const path of collectLeafPaths(block, 'block')) {
        const value = path.split('.').slice(1).reduce<any>((acc, key) => acc?.[key], block)
        expect(value, `${locale} ${path}`).toBeTruthy()
        expect(typeof value).toBe('string')
      }
      for (const type of expectedTypes) {
        expect(typeof block.typeLabels[type], `${locale} typeLabels.${type}`).toBe('string')
      }
    }
  })
})
