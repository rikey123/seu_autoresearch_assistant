// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ResearchPapersView from '@/views/research/ResearchPapersView.vue'
import { usePapersStore } from '@/stores/research/papers'
import { formatFileSize, formatImportedAt } from '@/utils/research-paper-format'

const listPapersMock = vi.hoisted(() => vi.fn())
const uploadPaperMock = vi.hoisted(() => vi.fn())
const deletePaperMock = vi.hoisted(() => vi.fn())
const routerPushMock = vi.hoisted(() => vi.fn())

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
    props: ['loading', 'type', 'size', 'quaternary', 'ariaLabel'],
    emits: ['click'],
    template: '<button type="button" :disabled="loading" @click="$emit(\'click\')"><slot /></button>',
  }),
  NEmpty: defineComponent({
    props: ['description'],
    template: '<div class="n-empty-stub">{{ description }}</div>',
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
    props: ['size', 'bordered'],
    template: '<span class="n-tag-stub"><slot /></span>',
  }),
}))

vi.mock('@/api/studio/research-library', () => ({
  listPapers: listPapersMock,
  uploadPaper: uploadPaperMock,
  deletePaper: deletePaperMock,
  paperFileUrl: (id: string) => `/api/studio/research/library/papers/${id}/file`,
}))

function paperRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'paper-1',
    title: 'Attention Is All You Need',
    original_name: 'attention.pdf',
    authors: [],
    year: 2017,
    venue: 'NeurIPS',
    tags: ['transformers'],
    file_size: 3 * 1024 * 1024,
    created_at: new Date('2026-09-01T10:30:00').getTime(),
    updated_at: new Date('2026-09-01T10:30:00').getTime(),
    ...overrides,
  }
}

function chooseFile(wrapper: ReturnType<typeof mount>, file: File): Promise<void> {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  return input.trigger('change')
}

describe('research paper library view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    listPapersMock.mockResolvedValue([])
  })

  it('lists papers with name, size, and import time', async () => {
    listPapersMock.mockResolvedValue([paperRecord()])
    const wrapper = mount(ResearchPapersView)
    await flushPromises()

    expect(listPapersMock).toHaveBeenCalledTimes(1)
    const items = wrapper.findAll('.paper-item')
    expect(items).toHaveLength(1)
    expect(wrapper.find('.paper-title').text()).toBe('Attention Is All You Need')
    expect(wrapper.find('.paper-size').text()).toBe(formatFileSize(3 * 1024 * 1024))
    expect(wrapper.find('.paper-time').text()).toBe(formatImportedAt(paperRecord().created_at))
    expect(wrapper.findAll('.n-tag-stub').map(tag => tag.text())).toEqual(['transformers'])
  })

  it('shows the empty state and the failure state with retry', async () => {
    const wrapper = mount(ResearchPapersView)
    await flushPromises()
    expect(wrapper.find('.n-empty-stub').text()).toBe('research.papers.empty')

    listPapersMock.mockRejectedValueOnce(new Error('offline'))
    const failing = mount(ResearchPapersView)
    await flushPromises()
    expect(failing.text()).toContain('research.papers.loadFailed')

    await failing.get('.papers-state button').trigger('click')
    await flushPromises()
    expect(listPapersMock).toHaveBeenCalledTimes(3)
  })

  it('imports a chosen PDF through the store and refreshes the list', async () => {
    const wrapper = mount(ResearchPapersView)
    await flushPromises()

    const file = new File(['%PDF-1.4 fake'], 'new-paper.pdf', { type: 'application/pdf' })
    uploadPaperMock.mockResolvedValueOnce(paperRecord({ id: 'paper-2', title: 'New paper' }))
    listPapersMock.mockResolvedValueOnce([
      paperRecord({ id: 'paper-2', title: 'New paper' }),
      paperRecord(),
    ])
    await chooseFile(wrapper, file)
    await flushPromises()

    expect(uploadPaperMock).toHaveBeenCalledTimes(1)
    const uploaded = uploadPaperMock.mock.calls[0][0] as File
    expect(uploaded.name).toBe('new-paper.pdf')
    expect(wrapper.findAll('.paper-item')).toHaveLength(2)
    expect(wrapper.text()).toContain('research.papers.uploadSuccess')
  })

  it('surfaces an upload failure notice for rejected files', async () => {
    const wrapper = mount(ResearchPapersView)
    await flushPromises()

    uploadPaperMock.mockRejectedValueOnce(new Error('not a pdf'))
    await chooseFile(wrapper, new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    await flushPromises()

    expect(wrapper.text()).toContain('research.papers.uploadFailed')
    expect(wrapper.findAll('.paper-item')).toHaveLength(0)
  })

  it('navigates to the PDF preview route when a paper is clicked', async () => {
    listPapersMock.mockResolvedValue([paperRecord()])
    const wrapper = mount(ResearchPapersView)
    await flushPromises()

    await wrapper.get('.paper-main').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'research.papers.preview',
      params: { paperId: 'paper-1' },
    })
  })

  it('deletes a paper only after the popconfirm is accepted', async () => {
    listPapersMock.mockResolvedValue([paperRecord()])
    const wrapper = mount(ResearchPapersView)
    await flushPromises()

    await wrapper.get('.paper-delete').trigger('click')
    expect(deletePaperMock).not.toHaveBeenCalled()

    deletePaperMock.mockResolvedValueOnce(undefined)
    await wrapper.get('.popconfirm-positive').trigger('click')
    await flushPromises()

    expect(deletePaperMock).toHaveBeenCalledWith('paper-1')
    expect(wrapper.findAll('.paper-item')).toHaveLength(0)
    expect(wrapper.text()).toContain('research.papers.deleteSuccess')
  })

  it('keeps the paper row when deletion fails', async () => {
    listPapersMock.mockResolvedValue([paperRecord()])
    const wrapper = mount(ResearchPapersView)
    await flushPromises()

    deletePaperMock.mockRejectedValueOnce(new Error('locked'))
    await wrapper.get('.popconfirm-positive').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('research.papers.deleteFailed')
    expect(wrapper.findAll('.paper-item')).toHaveLength(1)
  })
})

describe('research paper library store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    listPapersMock.mockResolvedValue([])
  })

  it('tracks loading, upload, and delete state transitions', async () => {
    const store = usePapersStore()
    expect(store.papers).toEqual([])

    listPapersMock.mockResolvedValueOnce([paperRecord()])
    await store.refresh()
    expect(store.papers).toHaveLength(1)
    expect(store.paperById('paper-1')?.title).toBe('Attention Is All You Need')
    expect(store.paperById('missing')).toBeNull()

    uploadPaperMock.mockResolvedValueOnce(paperRecord({ id: 'paper-2' }))
    listPapersMock.mockResolvedValueOnce([paperRecord({ id: 'paper-2' }), paperRecord()])
    const imported = await store.importPaper(new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }))
    expect(imported).toBe(true)
    expect(store.papers).toHaveLength(2)
    expect(store.notice).toMatchObject({ kind: 'success' })

    deletePaperMock.mockResolvedValueOnce(undefined)
    const removed = await store.removePaper('paper-2')
    expect(removed).toBe(true)
    expect(store.papers.map(paper => paper.id)).toEqual(['paper-1'])

    store.clearNotice()
    expect(store.notice).toBeNull()
  })

  it('formats sizes and import timestamps for the list columns', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatImportedAt(0)).toBe('')
    expect(formatImportedAt(new Date('2026-09-01T10:30:00').getTime())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
