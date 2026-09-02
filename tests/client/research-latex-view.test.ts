// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

const mocks = vi.hoisted(() => ({
  listLatexDocuments: vi.fn(),
  fetchLatexDocument: vi.fn(),
  createLatexDocument: vi.fn(),
  updateLatexDocument: vi.fn(),
  deleteLatexDocument: vi.fn(),
  compileLatexDocument: vi.fn(),
  fetchLatestLatexCompilation: vi.fn(),
  fetchLatexCompilationPdf: vi.fn(),
  fetchLatexEngineInfo: vi.fn(),
}))

vi.mock('@/api/studio/latex', () => mocks)

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'line' in params ? `${key}:${params.line}` : key,
  }),
}))

vi.mock('@/views/research/ResearchTabNav.vue', () => ({
  default: defineComponent({ template: '<nav class="tab-nav-stub" />' }),
}))

vi.mock('@/components/hermes/files/PdfFilePreview.vue', () => ({
  default: defineComponent({
    props: { data: { type: null, default: null } },
    emits: ['error'],
    template: '<div class="pdf-stub" :data-bytes="data ? data.byteLength : 0" />',
  }),
}))

import ResearchLatexView from '@/views/research/ResearchLatexView.vue'

const POLL_INTERVAL_MS = 1000

const DOC_ID = 'doc-1'
const SOURCE = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\brokenmacro',
  '\\end{document}',
  '',
].join('\n')

function baseDocument() {
  return {
    id: DOC_ID,
    title: 'Intro paper',
    source: SOURCE,
    project_id: null,
    created_at: 1_000,
    updated_at: 2_000,
  }
}

function queuedCompilation() {
  return {
    id: 'comp-1',
    document_id: DOC_ID,
    status: 'queued',
    engine: 'tectonic',
    exit_code: null,
    artifact_id: null,
    errors: [],
    log: '',
    created_at: 3_000,
    updated_at: 3_000,
    started_at: null,
    finished_at: null,
  }
}

async function mountView() {
  const wrapper = mount(ResearchLatexView)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listLatexDocuments.mockResolvedValue([baseDocument()])
  mocks.fetchLatexDocument.mockResolvedValue(baseDocument())
  mocks.fetchLatestLatexCompilation.mockResolvedValue(null)
  mocks.fetchLatexEngineInfo.mockResolvedValue({ available: true, source: 'path', bin: '/usr/bin/tectonic' })
})

describe('ResearchLatexView', () => {
  it('loads the document list and shows the selected source in the editor', async () => {
    const wrapper = await mountView()

    expect(mocks.listLatexDocuments).toHaveBeenCalledOnce()
    expect(mocks.fetchLatexDocument).toHaveBeenCalledWith(DOC_ID)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(SOURCE)
    expect((wrapper.get('.title-input').element as HTMLInputElement).value).toBe('Intro paper')
    expect(wrapper.find('.doc-item.active').exists()).toBe(true)
  })

  it('auto-saves dirty sources before enqueueing a compile', async () => {
    mocks.compileLatexDocument.mockResolvedValue(queuedCompilation())
    mocks.updateLatexDocument.mockResolvedValue({ ...baseDocument(), updated_at: 4_000 })
    const wrapper = await mountView()

    await wrapper.get('textarea').setValue(SOURCE.replace('\\brokenmacro', 'Fixed text'))
    await wrapper.get('.tool-btn.primary').trigger('click')
    await flushPromises()

    expect(mocks.updateLatexDocument).toHaveBeenCalledWith(DOC_ID, {
      title: 'Intro paper',
      source: SOURCE.replace('\\brokenmacro', 'Fixed text'),
    })
    expect(mocks.compileLatexDocument).toHaveBeenCalledWith(DOC_ID)
    const updateCallOrder = mocks.updateLatexDocument.mock.invocationCallOrder[0]
    const compileCallOrder = mocks.compileLatexDocument.mock.invocationCallOrder[0]
    expect(updateCallOrder).toBeLessThan(compileCallOrder)
  })

  it('renders structured compile errors and highlights the clicked line in the editor', async () => {
    vi.useFakeTimers()
    try {
      mocks.compileLatexDocument.mockResolvedValue(queuedCompilation())
      mocks.fetchLatestLatexCompilation.mockResolvedValue({
        ...queuedCompilation(),
        status: 'failed',
        exit_code: 1,
        errors: [
          { file: './main.tex', line: 3, message: 'Undefined control sequence.' },
          { file: '', line: null, message: 'The TeX compiler exited with bad status.' },
        ],
      })
      const wrapper = await mountView()

      await wrapper.get('.tool-btn.primary').trigger('click')
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushPromises()

      const items = wrapper.findAll('.error-item')
      expect(items).toHaveLength(2)
      expect(items[0].text()).toContain('./main.tex')
      expect(items[0].text()).toContain('research.latex.lineLabel:3')
      expect(items[0].text()).toContain('Undefined control sequence.')

      const textarea = wrapper.get('textarea').element as HTMLTextAreaElement
      const lines = SOURCE.split('\n')
      let expectedStart = 0
      for (let i = 0; i < 2; i++) expectedStart += lines[i].length + 1
      await items[0].trigger('click')
      expect(textarea.selectionStart).toBe(expectedStart)
      expect(textarea.selectionEnd).toBe(expectedStart + lines[2].length)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps an unconfigured engine to the engine-unavailable copy', async () => {
    mocks.compileLatexDocument.mockRejectedValue(
      Object.assign(new Error('tectonic compiler is not configured; set TECTONIC_BIN or install tectonic in PATH'), {
        status: 503,
        code: 'engine_unavailable',
      }),
    )
    const wrapper = await mountView()

    await wrapper.get('.tool-btn.primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('.action-error').text()).toBe('research.latex.engineUnavailable')
    expect(wrapper.findAll('.error-item')).toHaveLength(0)
  })

  it('loads the compiled PDF into the preview when a compilation completes', async () => {
    vi.useFakeTimers()
    try {
      const pdfBytes = new Uint8Array([1, 2, 3, 4]).buffer
      // The compile POST returns a queued run; the latest-compilation GET only
      // starts answering "completed" after that POST happened.
      let latest: Record<string, unknown> | null = null
      mocks.fetchLatestLatexCompilation.mockImplementation(() => Promise.resolve(latest))
      mocks.compileLatexDocument.mockImplementation(() => {
        latest = {
          ...queuedCompilation(),
          status: 'completed',
          exit_code: 0,
          artifact_id: 'artifact-1',
        }
        return Promise.resolve(queuedCompilation())
      })
      mocks.fetchLatexCompilationPdf.mockResolvedValue(pdfBytes)
      const wrapper = await mountView()

      expect(wrapper.find('.pdf-stub').exists()).toBe(false)
      await wrapper.get('.tool-btn.primary').trigger('click')
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushPromises()

      expect(mocks.fetchLatexCompilationPdf).toHaveBeenCalledWith('comp-1')
      expect(wrapper.get('.pdf-stub').attributes('data-bytes')).toBe('4')
      expect(wrapper.get('.status-chip').attributes('data-status')).toBe('completed')
    } finally {
      vi.useRealTimers()
    }
  })
})
