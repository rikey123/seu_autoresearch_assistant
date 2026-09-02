// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ResearchKnowledgeView from '@/views/research/ResearchKnowledgeView.vue'
import { KNOWLEDGE_POLL_TIMEOUT_MS, useKnowledgeStore } from '@/stores/research/knowledge'

const knowledgeApi = vi.hoisted(() => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  startIndexing: vi.fn(),
  getLatestIndexJob: vi.fn(),
  askQuestion: vi.fn(),
  getQuestion: vi.fn(),
  getHistory: vi.fn(),
}))
const listPapersMock = vi.hoisted(() => vi.fn())
const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'research.knowledge', params: {} }),
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock('naive-ui', () => ({
  NButton: defineComponent({
    props: ['loading', 'type', 'size', 'quaternary', 'disabled'],
    emits: ['click'],
    template: `<button type="button" :disabled="loading || disabled" @click="$emit('click')"><slot /></button>`,
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
  NSelect: defineComponent({
    props: ['value', 'options', 'placeholder', 'loading', 'clearable', 'size'],
    emits: ['update:value'],
    template: '<select class="n-select-stub" @change="$emit(\'update:value\', $event.target.value)">'
      + '<option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>'
      + '</select>',
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
  NTag: defineComponent({
    props: ['type', 'size', 'bordered'],
    template: '<span class="n-tag-stub"><slot /></span>',
  }),
}))

vi.mock('@/api/studio/research-knowledge', () => knowledgeApi)
vi.mock('@/api/studio/research-library', () => ({
  listPapers: listPapersMock,
  uploadPaper: vi.fn(),
  deletePaper: vi.fn(),
  paperFileUrl: (id: string) => `/api/studio/research/library/papers/${id}/file`,
}))

function collection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-1',
    name: 'Transformers',
    description: 'attention papers',
    index_status: 'unindexed',
    chunks: 0,
    engine: '',
    indexed_at: null,
    created_at: 1,
    updated_at: 1,
    paper_count: 0,
    ...overrides,
  }
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    paper_id: 'paper-1',
    added_at: 1,
    title: 'Attention Is All You Need',
    original_name: 'attention.pdf',
    file_exists: true,
    ...overrides,
  }
}

function question(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    collection_id: 'col-1',
    status: 'answered',
    question: 'What is attention?',
    answer: 'Attention lets networks focus.',
    citations: [{ paperId: 'paper-1', page: 3, snippet: 'We propose a new mechanism' }],
    engine: 'stub',
    error: null,
    created_at: 1,
    updated_at: 1,
    finished_at: 2,
    ...overrides,
  }
}

async function mountView() {
  const wrapper = mount(ResearchKnowledgeView)
  await flushPromises()
  return wrapper
}

describe('research knowledge view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    knowledgeApi.listCollections.mockResolvedValue([])
    knowledgeApi.listMembers.mockResolvedValue([])
    knowledgeApi.getHistory.mockResolvedValue([])
    listPapersMock.mockResolvedValue([])
  })

  it('lists collections with name, paper count, and index status tag', async () => {
    knowledgeApi.listCollections.mockResolvedValue([
      collection({ index_status: 'indexed', paper_count: 3 }),
    ])
    const wrapper = await mountView()
    expect(wrapper.find('.collection-name').text()).toBe('Transformers')
    expect(wrapper.find('.collection-meta').text()).toContain('3')
    expect(wrapper.findAll('.n-tag-stub').map(tag => tag.text())).toContain('research.rag.status.indexed')
  })

  it('creates a collection through the inline form and refreshes the list', async () => {
    const wrapper = await mountView()
    await wrapper.get('.collections-toolbar button').trigger('click')
    const inputs = wrapper.findAll('.collection-create .n-input-stub')
    await inputs[0].setValue('New KB')
    await inputs[1].setValue('desc')
    knowledgeApi.createCollection.mockResolvedValueOnce(collection({ id: 'col-2', name: 'New KB' }))
    await wrapper.get('.collection-create button').trigger('click')
    await flushPromises()

    expect(knowledgeApi.createCollection).toHaveBeenCalledWith('New KB', 'desc')
    expect(wrapper.findAll('.collection-item')).toHaveLength(1)
  })

  it('selects a collection and loads its members and history', async () => {
    knowledgeApi.listCollections.mockResolvedValue([collection()])
    knowledgeApi.listMembers.mockResolvedValue([member()])
    knowledgeApi.getHistory.mockResolvedValue([question()])
    const wrapper = await mountView()

    await wrapper.get('.collection-main').trigger('click')
    await flushPromises()

    expect(knowledgeApi.listMembers).toHaveBeenCalledWith('col-1')
    expect(knowledgeApi.getHistory).toHaveBeenCalledWith('col-1')
    expect(wrapper.findAll('.member-item')).toHaveLength(1)
    expect(wrapper.find('.history-question').text()).toBe('What is attention?')
    expect(wrapper.find('.answer-text').text()).toBe('Attention lets networks focus.')
  })

  it('adds a member paper from the library picker', async () => {
    knowledgeApi.listCollections.mockResolvedValue([collection()])
    listPapersMock.mockResolvedValue([
      { id: 'paper-9', title: 'BERT', original_name: 'bert.pdf' },
    ])
    const wrapper = await mountView()
    await wrapper.get('.collection-main').trigger('click')
    await flushPromises()

    const select = wrapper.get('select.member-select')
    await select.setValue('paper-9')
    knowledgeApi.addMember.mockResolvedValueOnce(member({ paper_id: 'paper-9', title: 'BERT' }))
    await wrapper.get('.member-picker button').trigger('click')
    await flushPromises()

    expect(knowledgeApi.addMember).toHaveBeenCalledWith('col-1', 'paper-9')
    expect(wrapper.findAll('.member-item')).toHaveLength(1)
  })

  it('removes a member only after the popconfirm is accepted', async () => {
    knowledgeApi.listCollections.mockResolvedValue([collection()])
    knowledgeApi.listMembers.mockResolvedValue([member()])
    const wrapper = await mountView()
    await wrapper.get('.collection-main').trigger('click')
    await flushPromises()

    await wrapper.get('.member-item .n-popconfirm-stub button').trigger('click')
    expect(knowledgeApi.removeMember).not.toHaveBeenCalled()
    knowledgeApi.removeMember.mockResolvedValueOnce(undefined)
    await wrapper.get('.member-item .popconfirm-positive').trigger('click')
    await flushPromises()
    expect(knowledgeApi.removeMember).toHaveBeenCalledWith('col-1', 'paper-1')
  })

  it('runs an index job to completion and shows the resulting state', async () => {
    knowledgeApi.listCollections.mockResolvedValue([
      collection({ index_status: 'unindexed', paper_count: 1 }),
    ])
    knowledgeApi.listMembers.mockResolvedValue([member()])
    const wrapper = await mountView()
    await wrapper.get('.collection-main').trigger('click')
    await flushPromises()

    knowledgeApi.startIndexing.mockResolvedValueOnce({
      id: 'job-1', collection_id: 'col-1', status: 'queued', attempts: 0,
      papers_count: 1, chunks: 0, engine: '', error: null,
      created_at: 1, updated_at: 1, started_at: null, finished_at: null,
    })
    knowledgeApi.getLatestIndexJob.mockResolvedValueOnce({
      id: 'job-1', collection_id: 'col-1', status: 'completed', attempts: 1,
      papers_count: 1, chunks: 12, engine: 'paper-qa', error: null,
      created_at: 1, updated_at: 2, started_at: 1, finished_at: 2,
    })
    knowledgeApi.listCollections.mockResolvedValueOnce([
      collection({ index_status: 'indexed', chunks: 12, engine: 'paper-qa', paper_count: 1 }),
    ])
    await wrapper.get('.detail-actions button').trigger('click')
    await flushPromises()

    expect(knowledgeApi.startIndexing).toHaveBeenCalledWith('col-1')
    expect(wrapper.find('.index-chunks').text()).toContain('12')
  })

  it('submits a question and renders the answer with citations', async () => {
    knowledgeApi.listCollections.mockResolvedValue([
      collection({ index_status: 'indexed', paper_count: 1 }),
    ])
    const wrapper = await mountView()
    await wrapper.get('.collection-main').trigger('click')
    await flushPromises()

    const input = wrapper.get('.ask-input .n-input-stub')
    await input.setValue('What is attention?')
    knowledgeApi.askQuestion.mockResolvedValueOnce(question({ status: 'queued', answer: null, citations: [] }))
    knowledgeApi.getQuestion.mockResolvedValue(question())
    await wrapper.get('.ask-input button').trigger('click')
    await flushPromises()

    expect(knowledgeApi.askQuestion).toHaveBeenCalledWith('col-1', 'What is attention?')
    expect(wrapper.find('.answer-text').text()).toBe('Attention lets networks focus.')
    expect(wrapper.findAll('.citation-item')).toHaveLength(1)
  })

  it('navigates to the paper preview route when a citation is clicked', async () => {
    knowledgeApi.listCollections.mockResolvedValue([
      collection({ index_status: 'indexed', paper_count: 1 }),
    ])
    knowledgeApi.listMembers.mockResolvedValue([member()])
    knowledgeApi.getHistory.mockResolvedValue([question()])
    const wrapper = await mountView()
    await wrapper.get('.collection-main').trigger('click')
    await flushPromises()

    await wrapper.get('.citation-main').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'research.papers.preview',
      params: { paperId: 'paper-1' },
    })

    await wrapper.get('.member-main').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'research.papers.preview',
      params: { paperId: 'paper-1' },
    })
  })

  it('shows the empty state, failure state, and disabled ask before indexing', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.n-empty-stub').text()).toBe('research.rag.empty')

    knowledgeApi.listCollections.mockRejectedValueOnce(new Error('offline'))
    const failing = mount(ResearchKnowledgeView)
    await flushPromises()
    expect(failing.text()).toContain('research.rag.loadFailed')

    knowledgeApi.listCollections.mockResolvedValue([collection()])
    const withCollection = mount(ResearchKnowledgeView)
    await flushPromises()
    await withCollection.get('.collection-main').trigger('click')
    await flushPromises()
    expect(withCollection.get('.ask-input button').attributes('disabled')).toBeDefined()
    expect(withCollection.text()).toContain('research.rag.askNeedsIndex')
  })
})

describe('research knowledge store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    knowledgeApi.listCollections.mockResolvedValue([])
    knowledgeApi.listMembers.mockResolvedValue([])
    knowledgeApi.getHistory.mockResolvedValue([])
  })

  it('tracks collection lifecycle, membership, and question polling', async () => {
    const store = useKnowledgeStore()
    await store.refresh()
    expect(store.collections).toEqual([])

    knowledgeApi.createCollection.mockResolvedValueOnce(collection())
    expect(await store.create('KB', 'd')).toBe(true)
    expect(store.collections).toHaveLength(1)
    expect(store.notice?.kind).toBe('success')

    knowledgeApi.listCollections.mockResolvedValue([collection()])
    store.select('col-1')
    await flushPromises()
    expect(store.selected?.id).toBe('col-1')

    knowledgeApi.addMember.mockResolvedValueOnce(member())
    expect(await store.addPaper('paper-1')).toBe(true)
    expect(store.members).toHaveLength(1)

    knowledgeApi.removeMember.mockResolvedValueOnce(undefined)
    expect(await store.removePaper('paper-1')).toBe(true)
    expect(store.members).toHaveLength(0)

    knowledgeApi.startIndexing.mockResolvedValueOnce({
      id: 'job-1', collection_id: 'col-1', status: 'queued', attempts: 0,
      papers_count: 1, chunks: 0, engine: '', error: null,
      created_at: 1, updated_at: 1, started_at: null, finished_at: null,
    })
    knowledgeApi.getLatestIndexJob
      .mockResolvedValueOnce({ id: 'job-1', status: 'running' })
      .mockResolvedValueOnce({
        id: 'job-1', collection_id: 'col-1', status: 'completed', attempts: 1,
        papers_count: 1, chunks: 7, engine: 'paper-qa', error: null,
        created_at: 1, updated_at: 2, started_at: 1, finished_at: 2,
      })
    knowledgeApi.listCollections.mockResolvedValue([
      collection({ index_status: 'indexed', chunks: 7, engine: 'paper-qa' }),
    ])
    expect(await store.startIndexing()).toBe(true)
    expect(store.latestJob?.chunks).toBe(7)

    knowledgeApi.askQuestion.mockResolvedValueOnce(question({ status: 'queued', answer: null, citations: [] }))
    knowledgeApi.getQuestion
      .mockResolvedValueOnce(question({ status: 'running', answer: null, citations: [] }))
      .mockResolvedValueOnce(question())
    expect(await store.ask('What is attention?')).toBe(true)
    expect(store.history[0]?.status).toBe('answered')
    expect(store.pendingQuestionIds).toHaveLength(0)
    store.clearNotice()
    expect(store.notice).toBeNull()
  })

  it('records failures for index jobs and questions with the error detail', async () => {
    const store = useKnowledgeStore()
    knowledgeApi.listCollections.mockResolvedValue([collection()])
    await store.refresh()
    store.select('col-1')
    await flushPromises()

    knowledgeApi.startIndexing.mockResolvedValueOnce({
      id: 'job-2', collection_id: 'col-1', status: 'queued', attempts: 0,
      papers_count: 0, chunks: 0, engine: '', error: null,
      created_at: 1, updated_at: 1, started_at: null, finished_at: null,
    })
    knowledgeApi.getLatestIndexJob.mockResolvedValue({
      id: 'job-2', collection_id: 'col-1', status: 'failed', attempts: 1,
      papers_count: 0, chunks: 0, engine: '', error: 'sidecar exploded',
      created_at: 1, updated_at: 2, started_at: 1, finished_at: 2,
    })
    expect(await store.startIndexing()).toBe(false)
    expect(store.notice?.key).toBe('research.rag.indexFailed')
    expect(store.notice?.detail).toBe('sidecar exploded')

    knowledgeApi.askQuestion.mockResolvedValueOnce(question({ status: 'queued', answer: null, citations: [] }))
    knowledgeApi.getQuestion.mockResolvedValue(question({ status: 'failed', answer: null, error: 'no answer' }))
    expect(await store.ask('why')).toBe(false)
    expect(store.notice?.key).toBe('research.rag.askFailed')
    expect(store.notice?.detail).toBe('no answer')
  })

  function indexJob(overrides: Record<string, unknown> = {}) {
    return {
      id: 'job-1',
      collection_id: 'col-1',
      status: 'queued',
      attempts: 0,
      papers_count: 1,
      chunks: 0,
      engine: '',
      error: null,
      created_at: 1,
      updated_at: 1,
      started_at: null,
      finished_at: null,
      ...overrides,
    }
  }

  function mountSelectedStore() {
    const store = useKnowledgeStore()
    store.collections = [collection(), collection({ id: 'col-2', name: 'Other' })]
    store.selectedId = 'col-1'
    return store
  }

  it('aborts the index poll immediately when the user switches collections', async () => {
    vi.useFakeTimers()
    try {
      const store = mountSelectedStore()
      knowledgeApi.startIndexing.mockResolvedValueOnce(indexJob())
      knowledgeApi.getLatestIndexJob.mockResolvedValue(indexJob({ status: 'running', attempts: 1, started_at: 1 }))

      const done = store.startIndexing()
      await vi.advanceTimersByTimeAsync(600)
      store.selectedId = 'col-2'
      // The pending poll sleep must fire before the abort check runs again.
      await vi.advanceTimersByTimeAsync(600)
      expect(await done).toBe(false)
      expect(store.notice?.key).toBe('research.rag.indexFailed')
      expect(store.notice?.detail).toContain('knowledge base selection changed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts the index poll when the latest job id no longer matches', async () => {
    vi.useFakeTimers()
    try {
      const store = mountSelectedStore()
      knowledgeApi.startIndexing.mockResolvedValueOnce(indexJob())
      knowledgeApi.getLatestIndexJob.mockResolvedValue(indexJob({ id: 'job-999', status: 'running', attempts: 1 }))

      const done = store.startIndexing()
      await vi.advanceTimersByTimeAsync(5000)
      expect(await done).toBe(false)
      expect(store.notice?.detail).toContain('no longer matches the latest job')
      expect(store.latestJob?.id).toBe('job-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up the index poll after the polling timeout instead of spinning forever', async () => {
    vi.useFakeTimers()
    try {
      const store = mountSelectedStore()
      knowledgeApi.startIndexing.mockResolvedValueOnce(indexJob())
      knowledgeApi.getLatestIndexJob.mockResolvedValue(indexJob({ status: 'running', attempts: 1, started_at: 1 }))

      const done = store.startIndexing()
      await vi.advanceTimersByTimeAsync(KNOWLEDGE_POLL_TIMEOUT_MS + 1000)
      expect(await done).toBe(false)
      expect(store.notice?.key).toBe('research.rag.indexFailed')
      expect(store.notice?.detail).toContain('polling timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts the question poll on collection switch and releases the pending id', async () => {
    vi.useFakeTimers()
    try {
      const store = mountSelectedStore()
      knowledgeApi.askQuestion.mockResolvedValueOnce(question({ id: 'q-1', status: 'queued', answer: null, citations: [] }))
      knowledgeApi.getQuestion.mockResolvedValue(question({ id: 'q-1', status: 'running', answer: null, citations: [] }))

      const done = store.ask('What is attention?')
      await vi.advanceTimersByTimeAsync(600)
      store.selectedId = 'col-2'
      // The pending poll sleep must fire before the abort check runs again.
      await vi.advanceTimersByTimeAsync(600)
      expect(await done).toBe(false)
      expect(store.notice?.key).toBe('research.rag.askFailed')
      expect(store.notice?.detail).toContain('knowledge base selection changed')
      expect(store.pendingQuestionIds).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up the question poll after the polling timeout', async () => {
    vi.useFakeTimers()
    try {
      const store = mountSelectedStore()
      knowledgeApi.askQuestion.mockResolvedValueOnce(question({ id: 'q-1', status: 'queued', answer: null, citations: [] }))
      knowledgeApi.getQuestion.mockResolvedValue(question({ id: 'q-1', status: 'running', answer: null, citations: [] }))

      const done = store.ask('What is attention?')
      await vi.advanceTimersByTimeAsync(KNOWLEDGE_POLL_TIMEOUT_MS + 1000)
      expect(await done).toBe(false)
      expect(store.notice?.detail).toContain('polling timeout')
      expect(store.pendingQuestionIds).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
