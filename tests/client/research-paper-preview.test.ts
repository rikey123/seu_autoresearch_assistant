// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ResearchPaperPreviewView from '@/views/research/ResearchPaperPreviewView.vue'
import PaperPdfPreview from '@/views/research/PaperPdfPreview.vue'

const requestMock = vi.hoisted(() => vi.fn())
const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { paperId: 'paper-1' } }),
  useRouter: () => ({ push: routerPushMock }),
}))

// Real API helpers run on top of a mocked transport so the streaming URL and
// its token parameter stay covered.
vi.mock('@/api/client', () => ({
  getApiKey: vi.fn(() => 'jwt-token'),
  request: requestMock,
}))

describe('research paper PDF preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    requestMock.mockResolvedValue({ papers: [] })
  })

  it('mounts the native PDF viewer iframe on the range-streaming route', () => {
    const wrapper = mount(PaperPdfPreview, { props: { paperId: 'paper-1' } })
    const frame = wrapper.find('iframe')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe(
      '/api/studio/research/library/papers/paper-1/file?token=jwt-token',
    )
  })

  it('reloads the frame and re-keys it when the paper changes', async () => {
    const wrapper = mount(PaperPdfPreview, { props: { paperId: 'paper-1' } })
    await wrapper.get('.pdf-reload').trigger('click')
    expect(wrapper.find('iframe').attributes('src')).toBe(
      '/api/studio/research/library/papers/paper-1/file?token=jwt-token&reload=1',
    )

    await wrapper.setProps({ paperId: 'paper-2' })
    expect(wrapper.find('iframe').attributes('src')).toBe(
      '/api/studio/research/library/papers/paper-2/file?token=jwt-token',
    )
  })

  it('shows the preview page with a back-to-list action', async () => {
    const wrapper = mount(ResearchPaperPreviewView)
    await flushPromises()

    expect(wrapper.find('iframe').attributes('src')).toContain(
      '/api/studio/research/library/papers/paper-1/file',
    )
    expect(wrapper.text()).toContain('research.papers.untitled')

    await wrapper.get('.preview-back').trigger('click')
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'research.papers' })
  })
})
