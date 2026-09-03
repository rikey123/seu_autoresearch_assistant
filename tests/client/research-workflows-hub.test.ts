// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import ResearchWorkflowsView from '@/views/research/ResearchWorkflowsView.vue'
import { useWorkflowHubStore } from '@/stores/research/workflow-hub'
import { templateToWorkflowCreateRequest } from '@/utils/research-workflow-template-mapping'
import { formatTimestamp } from '@/utils/research-paper-format'
import en from '../../packages/client/src/i18n/locales/en'
import zh from '../../packages/client/src/i18n/locales/zh'
import zhTW from '../../packages/client/src/i18n/locales/zh-TW'
import ar from '../../packages/client/src/i18n/locales/ar'
import de from '../../packages/client/src/i18n/locales/de'
import es from '../../packages/client/src/i18n/locales/es'
import fr from '../../packages/client/src/i18n/locales/fr'
import ja from '../../packages/client/src/i18n/locales/ja'
import ko from '../../packages/client/src/i18n/locales/ko'
import pt from '../../packages/client/src/i18n/locales/pt'
import ru from '../../packages/client/src/i18n/locales/ru'

const templatesApiMock = vi.hoisted(() => ({
  listResearchWorkflowTemplates: vi.fn(),
  fetchResearchWorkflowTemplate: vi.fn(),
}))
const workflowsApiMock = vi.hoisted(() => ({
  listWorkflows: vi.fn(),
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
}))
const routerPushMock = vi.hoisted(() => vi.fn())

// Keep the real vue-i18n (the locale block below builds real translators) and
// only replace the component-facing useI18n with a key/params echo.
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    }),
  }
})

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'research.workflows', params: {} }),
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock('naive-ui', () => ({
  NButton: defineComponent({
    props: ['loading', 'type', 'size', 'quaternary', 'disabled'],
    emits: ['click'],
    template: `<button type="button" :disabled="loading || disabled" @click="$emit('click', $event)"><slot /></button>`,
  }),
  NEmpty: defineComponent({
    props: ['description'],
    template: '<div class="n-empty-stub">{{ description }}</div>',
  }),
  NInput: defineComponent({
    props: ['value', 'modelValue', 'type', 'rows', 'placeholder', 'disabled'],
    emits: ['update:value', 'update:modelValue'],
    template: '<input class="n-input-stub" :placeholder="placeholder" :value="modelValue ?? value" '
      + '@input="$emit(\'update:value\', $event.target.value); $emit(\'update:modelValue\', $event.target.value)" />',
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
        <span class="popconfirm-body"><slot /></span>
        <button type="button" class="popconfirm-positive" @click="$emit('positive-click')">{{ positiveText }}</button>
      </span>
    `,
  }),
  NSpin: defineComponent({
    props: ['size'],
    template: '<div class="n-spin-stub"><slot /></div>',
  }),
  useMessage: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

vi.mock('@/api/studio/research-workflow-templates', () => templatesApiMock)
vi.mock('@/api/studio/workflows', () => workflowsApiMock)

const TEMPLATE_NODES = [
  {
    id: 'pt-pdf-intake',
    type: 'script',
    position: { x: 80, y: 120 },
    data: { title: 'PDF 接入校验', input: '', orchestration: { join: 'all' }, runtime: 'node', code: 'process.exit(0)' },
  },
  {
    id: 'pt-translate',
    type: 'script',
    position: { x: 360, y: 120 },
    data: { title: 'pdf2zh 翻译', input: '', orchestration: { join: 'all' }, runtime: 'node', code: 'process.exit(0)' },
  },
]
const TEMPLATE_EDGES = [
  { id: 'pt-e1', source: 'pt-pdf-intake', target: 'pt-translate', orchestration: { route: 'success' } },
]

function templateSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'paper-translate',
    name: '论文翻译',
    description: 'PDF 接入校验 → pdf2zh 翻译 → 双语对照 → 术语表沉淀。',
    profile: 'default',
    steps: ['PDF 接入校验', 'pdf2zh 翻译', '双语对照', '术语表沉淀'],
    nodeCount: 4,
    edgeCount: 3,
    nodeTypes: ['script', 'agent'],
    ...overrides,
  }
}

function fullTemplate(overrides: Record<string, unknown> = {}) {
  return {
    ...templateSummary(),
    nodes: TEMPLATE_NODES,
    edges: TEMPLATE_EDGES,
    ...overrides,
  }
}

function workflowRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    name: '文献综述流水线',
    profile: 'default',
    workspace: null,
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    edges: [],
    viewport: null,
    created_at: new Date('2026-09-01T10:30:00').getTime(),
    updated_at: new Date('2026-09-01T11:45:00').getTime(),
    ...overrides,
  }
}

function findConfirmButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.create-modal-footer button')[1]
}

describe('research workflows hub view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    templatesApiMock.listResearchWorkflowTemplates.mockResolvedValue([templateSummary()])
    templatesApiMock.fetchResearchWorkflowTemplate.mockResolvedValue(fullTemplate())
    workflowsApiMock.listWorkflows.mockResolvedValue([])
    workflowsApiMock.createWorkflow.mockResolvedValue(workflowRecord())
    workflowsApiMock.deleteWorkflow.mockResolvedValue(undefined)
  })

  it('renders the template gallery with name, description, and node count', async () => {
    templatesApiMock.listResearchWorkflowTemplates.mockResolvedValue([
      templateSummary(),
      templateSummary({ id: 'literature-review', name: '文献综述', nodeCount: 7 }),
    ])
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    expect(templatesApiMock.listResearchWorkflowTemplates).toHaveBeenCalledTimes(1)
    const cards = wrapper.findAll('.template-card')
    expect(cards).toHaveLength(2)
    const names = wrapper.findAll('.template-name').map(node => node.text())
    expect(names).toEqual(['论文翻译', '文献综述'])
    expect(wrapper.find('.template-desc').text()).toContain('pdf2zh')
    expect(cards[1].find('.template-meta').text()).toContain('"count":7')
    expect(wrapper.findAll('[data-testid="use-template"]')).toHaveLength(2)
  })

  it('creates a workflow from a template with a pass-through payload and deep-links into the canvas', async () => {
    workflowsApiMock.createWorkflow.mockResolvedValue(workflowRecord({ id: 'wf-new', name: '我的翻译流程' }))
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    await wrapper.get('[data-testid="use-template"]').trigger('click')
    // The name input is prefilled with the template name.
    const input = wrapper.get('[data-testid="workflow-name-input"]')
    expect((input.element as HTMLInputElement).value).toBe('论文翻译')
    await input.setValue('我的翻译流程')

    await findConfirmButton(wrapper).trigger('click')
    await flushPromises()

    expect(templatesApiMock.fetchResearchWorkflowTemplate).toHaveBeenCalledWith('paper-translate')
    expect(workflowsApiMock.createWorkflow).toHaveBeenCalledTimes(1)
    const payload = workflowsApiMock.createWorkflow.mock.calls[0][0]
    expect(payload).toEqual({
      name: '我的翻译流程',
      profile: 'default',
      nodes: TEMPLATE_NODES,
      edges: TEMPLATE_EDGES,
    })
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'hermes.workflow',
      query: { workflowId: 'wf-new' },
    })
    // The new flow shows up in "my workflows" without a manual refresh.
    expect(wrapper.findAll('.flow-item')).toHaveLength(1)
  })

  it('blocks the create confirmation while the name is blank', async () => {
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    await wrapper.get('[data-testid="use-template"]').trigger('click')
    const confirm = findConfirmButton(wrapper)
    expect(confirm.attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="workflow-name-input"]').setValue('   ')
    expect(findConfirmButton(wrapper).attributes('disabled')).toBeDefined()
    await findConfirmButton(wrapper).trigger('click')
    await flushPromises()
    expect(workflowsApiMock.createWorkflow).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows a failure notice when creation fails', async () => {
    workflowsApiMock.createWorkflow.mockRejectedValueOnce(new Error('offline'))
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    await wrapper.get('[data-testid="use-template"]').trigger('click')
    await findConfirmButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('research.workflows.createFailed')
    expect(wrapper.find('.n-modal-stub').exists()).toBe(true)
    expect(routerPushMock).not.toHaveBeenCalled()
  })

  it('lists my workflows with name, node count, and updated time', async () => {
    workflowsApiMock.listWorkflows.mockResolvedValue([workflowRecord()])
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    expect(workflowsApiMock.listWorkflows).toHaveBeenCalledTimes(1)
    const items = wrapper.findAll('.flow-item')
    expect(items).toHaveLength(1)
    expect(wrapper.find('.flow-name').text()).toBe('文献综述流水线')
    expect(wrapper.find('.flow-meta').text()).toContain('"count":2')
    expect(wrapper.find('.flow-time').text()).toBe(formatTimestamp(workflowRecord().updated_at))
  })

  it('opens the canvas through the row action and through the row itself', async () => {
    workflowsApiMock.listWorkflows.mockResolvedValue([workflowRecord()])
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    await wrapper.get('[data-testid="flow-open"]').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'hermes.workflow',
      query: { workflowId: 'wf-1' },
    })

    await wrapper.get('.flow-main').trigger('click')
    expect(routerPushMock).toHaveBeenCalledTimes(2)
  })

  it('deletes a workflow only after the popconfirm is accepted', async () => {
    workflowsApiMock.listWorkflows.mockResolvedValue([workflowRecord()])
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    await wrapper.get('[data-testid="flow-delete"]').trigger('click')
    expect(workflowsApiMock.deleteWorkflow).not.toHaveBeenCalled()

    await wrapper.get('.popconfirm-positive').trigger('click')
    await flushPromises()

    expect(workflowsApiMock.deleteWorkflow).toHaveBeenCalledWith('wf-1')
    expect(wrapper.findAll('.flow-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('research.workflows.deleteSuccess')
  })

  it('keeps the flow row when deletion fails', async () => {
    workflowsApiMock.listWorkflows.mockResolvedValue([workflowRecord()])
    workflowsApiMock.deleteWorkflow.mockRejectedValueOnce(new Error('locked'))
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    await wrapper.get('[data-testid="flow-delete"]').trigger('click')
    await wrapper.get('.popconfirm-positive').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('research.workflows.deleteFailed')
    expect(wrapper.findAll('.flow-item')).toHaveLength(1)
  })

  it('shows the empty state guidance pointing at the template gallery', async () => {
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    expect(wrapper.find('.flows-empty').exists()).toBe(true)
    expect(wrapper.find('.n-empty-stub').text()).toBe('research.workflows.flowsEmpty')
    expect(wrapper.text()).toContain('research.workflows.flowsEmptyHint')
  })

  it('surfaces load failures with retry for both sections', async () => {
    templatesApiMock.listResearchWorkflowTemplates.mockRejectedValue(new Error('offline'))
    workflowsApiMock.listWorkflows.mockRejectedValue(new Error('offline'))
    const wrapper = mount(ResearchWorkflowsView)
    await flushPromises()

    expect(wrapper.text()).toContain('research.workflows.templatesLoadFailed')
    expect(wrapper.text()).toContain('research.workflows.flowsLoadFailed')

    templatesApiMock.listResearchWorkflowTemplates.mockResolvedValue([templateSummary()])
    workflowsApiMock.listWorkflows.mockResolvedValue([])
    const states = wrapper.findAll('.hub-state button')
    await states[0].trigger('click')
    await flushPromises()
    expect(templatesApiMock.listResearchWorkflowTemplates).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('.template-card')).toHaveLength(1)
  })
})

describe('workflow hub store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    templatesApiMock.listResearchWorkflowTemplates.mockResolvedValue([templateSummary()])
    templatesApiMock.fetchResearchWorkflowTemplate.mockResolvedValue(fullTemplate())
    workflowsApiMock.listWorkflows.mockResolvedValue([workflowRecord()])
    workflowsApiMock.createWorkflow.mockResolvedValue(workflowRecord({ id: 'wf-new' }))
    workflowsApiMock.deleteWorkflow.mockResolvedValue(undefined)
  })

  it('loads templates and workflows and tracks state transitions', async () => {
    const store = useWorkflowHubStore()
    await Promise.all([store.refreshTemplates(), store.refreshWorkflows()])
    expect(store.templates).toHaveLength(1)
    expect(store.templateById('paper-translate')?.name).toBe('论文翻译')
    expect(store.templateById('missing')).toBeNull()
    expect(store.workflows).toHaveLength(1)
    expect(store.hasWorkflows).toBe(true)

    workflowsApiMock.deleteWorkflow.mockRejectedValueOnce(new Error('locked'))
    await store.removeWorkflow('wf-1')
    expect(store.notice).toMatchObject({ kind: 'error' })
    expect(store.workflows).toHaveLength(1)

    await store.removeWorkflow('wf-1')
    expect(store.workflows).toHaveLength(0)
    store.clearNotice()
    expect(store.notice).toBeNull()
  })

  it('creates a workflow from a template and prepends it to the list', async () => {
    const store = useWorkflowHubStore()
    await store.refreshWorkflows()
    workflowsApiMock.listWorkflows.mockResolvedValue([workflowRecord(), workflowRecord({ id: 'wf-new' })])

    const created = await store.createFromTemplate('paper-translate', '  自定义流程  ')
    expect(created?.id).toBe('wf-new')
    expect(store.workflows[0]?.id).toBe('wf-new')
    expect(store.notice).toMatchObject({ kind: 'success' })
  })
})

describe('template -> createWorkflow payload mapping (pure)', () => {
  it('passes the definition through untouched and carries profile/name', () => {
    const template = fullTemplate()
    const payload = templateToWorkflowCreateRequest(template, '我的翻译流程')
    expect(payload).toEqual({
      name: '我的翻译流程',
      profile: 'default',
      nodes: TEMPLATE_NODES,
      edges: TEMPLATE_EDGES,
    })
    // The payload arrays are copies, never aliases of the cached template.
    expect(payload.nodes).not.toBe(template.nodes)
    expect(payload.edges).not.toBe(template.edges)
  })

  it('falls back to the template name when the requested name is blank', () => {
    const payload = templateToWorkflowCreateRequest(fullTemplate(), '   ')
    expect(payload.name).toBe('论文翻译')
  })
})

const localeMessages: Record<string, Record<string, unknown>> = {
  en, zh, 'zh-TW': zhTW, ar, de, es, fr, ja, ko, pt, ru,
}

function collectLeafPaths(value: unknown, prefix: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectLeafPaths(child, `${prefix}.${key}`))
    .sort()
}

describe('research workflows hub locale coverage (11 locales)', () => {
  it('defines research.workflows with identical keys in every locale', () => {
    const englishPaths = collectLeafPaths(en.research.workflows, 'research.workflows')
    expect(englishPaths.length).toBeGreaterThanOrEqual(20)
    for (const [locale, messages] of Object.entries(localeMessages)) {
      expect(collectLeafPaths(messages.research.workflows, 'research.workflows'), `${locale} workflows keys`).toEqual(englishPaths)
    }
  })

  it('compiles and interpolates every workflows message in every locale', () => {
    const paths = collectLeafPaths(en.research.workflows, 'research.workflows')
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages } })
      for (const path of paths) {
        const rendered = i18n.global.t(path, { name: '文献综述', count: 4 })
        expect(rendered, `${locale} failed to compile ${path}`).not.toBe(path)
        expect(rendered.length, `${locale} resolved ${path} to an empty string`).toBeGreaterThan(0)
      }
      const confirm = i18n.global.t('research.workflows.deleteConfirmText', { name: '文献综述', count: 4 })
      expect(confirm, `${locale} interpolates deleteConfirmText`).toContain('文献综述')
      const nodes = i18n.global.t('research.workflows.nodeCount', { name: '文献综述', count: 4 })
      expect(nodes, `${locale} interpolates nodeCount`).toContain('4')
    }
  })
})
