// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, type Pinia } from 'pinia'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, source: string) => ({
    svg: `<svg id="${id}" data-testid="mermaid-svg"><text>${source}</text></svg>`,
  })),
}))

const katexMock = vi.hoisted(() => ({
  renderToString: vi.fn((src: string) => `<span class="katex">${src}</span>`),
}))

vi.mock('mermaid', () => ({
  default: mermaidMock,
}))

vi.mock('katex', () => ({
  default: katexMock,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

import MarkdownRenderer from '@/components/hermes/chat/MarkdownRenderer.vue'
import { useVcpPrefsStore } from '@/stores/hermes/vcp-prefs'

async function flushMermaidRender(): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    await nextTick()
    await Promise.resolve()
  }
}

describe('MarkdownRenderer VCP cards', () => {
  let pinia: Pinia

  function mountRenderer(content: string, headingIdPrefix = 'msg-1') {
    return mount(MarkdownRenderer, {
      props: { content, headingIdPrefix },
      global: { plugins: [pinia] },
    })
  }

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    mermaidMock.initialize.mockClear()
    mermaidMock.render.mockClear()
    mermaidMock.render.mockImplementation(async (id: string, source: string) => ({
      svg: `<svg id="${id}" data-testid="mermaid-svg"><text>${source}</text></svg>`,
    }))
    katexMock.renderToString.mockClear()
    katexMock.renderToString.mockImplementation((src: string) => {
      if (src.includes('BOOM')) throw new Error('katex render failed')
      return `<span class="katex">${src}</span>`
    })
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders an html fence as a sandboxed iframe card when VCP rendering is on', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```html\n<p>hello artifact</p>\n```')

    const card = wrapper.get('[data-vcp-card="html"]')
    expect(card.exists()).toBe(true)
    expect(card.find('.vcp-card-type').text()).toBe('chat.vcp.typeHtml')
    expect(card.find('.vcp-card-source').text()).toBe('msg-1')

    const iframe = card.get('iframe')
    const sandbox = iframe.attributes('sandbox') ?? ''
    expect(sandbox.split(/\s+/)).toContain('allow-scripts')
    expect(sandbox.split(/\s+/)).not.toContain('allow-same-origin')
    expect(iframe.attributes('srcdoc')).toContain('<p>hello artifact</p>')
  })

  it('renders an svg fence in a script-less fully sandboxed iframe card', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```svg\n<svg><circle r="4"/></svg>\n```')

    const iframe = wrapper.get('[data-vcp-card="svg"] iframe')
    const sandbox = iframe.attributes('sandbox') ?? ''
    expect(sandbox).toBe('')
    expect(sandbox.split(/\s+/)).not.toContain('allow-scripts')
    expect(sandbox.split(/\s+/)).not.toContain('allow-same-origin')
    expect(iframe.attributes('srcdoc')).toContain('<svg><circle r="4"/></svg>')
  })

  it('keeps html and svg fences as plain code blocks when rendering is off (default)', () => {
    const wrapper = mountRenderer(
      '```html\n<p>hello</p>\n```\n\n```svg\n<svg></svg>\n```',
    )

    expect(wrapper.find('[data-vcp-card]').exists()).toBe(false)
    expect(wrapper.findAll('.hljs-code-block')).toHaveLength(2)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('swaps between code blocks and cards when the render toggle flips', async () => {
    const store = useVcpPrefsStore(pinia)
    const wrapper = mountRenderer('```html\n<p>hello</p>\n```')
    expect(wrapper.find('[data-vcp-card]').exists()).toBe(false)
    expect(wrapper.find('.code-lang').text()).toBe('html')

    store.setRenderEnabled(true)
    await nextTick()
    expect(wrapper.find('[data-vcp-card="html"]').exists()).toBe(true)

    store.setRenderEnabled(false)
    await nextTick()
    expect(wrapper.find('[data-vcp-card]').exists()).toBe(false)
    expect(wrapper.find('.code-lang').text()).toBe('html')
  })

  it('applies the aesthetic class only while the aesthetic toggle is on', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const store = useVcpPrefsStore(pinia)
    const wrapper = mountRenderer('```html\n<p>x</p>\n```')
    expect(wrapper.find('.markdown-body').classes()).toContain('vcp-aesthetic')

    store.setAestheticEnabled(false)
    await nextTick()
    expect(wrapper.find('.markdown-body').classes()).not.toContain('vcp-aesthetic')
  })

  it('renders mermaid fences as a card containing the diagram when rendering is on', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```mermaid\nflowchart TD\nA --> B\n```')

    await flushMermaidRender()

    expect(wrapper.find('[data-vcp-card="mermaid"]').exists()).toBe(true)
    expect(mermaidMock.render).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mermaid-svg"]').exists()).toBe(true)
    expect(wrapper.find('.vcp-card .mermaid-diagram').exists()).toBe(true)
  })

  it('falls back to a code block with an error note when mermaid fails inside a card', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    mermaidMock.render.mockImplementationOnce(() => Promise.reject(new Error('bad diagram')))
    const wrapper = mountRenderer('```mermaid\nnot valid mermaid\n```')

    await flushMermaidRender()

    expect(wrapper.find('[data-vcp-card="mermaid"]').exists()).toBe(true)
    expect(wrapper.find('.vcp-render-fallback-note').exists()).toBe(true)
    expect(wrapper.find('.vcp-card .hljs-code-block').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('mermaid')
    expect(wrapper.find('.vcp-card code.hljs').text()).toContain('not valid mermaid')
  })

  it('renders katex and math fences as cards with katex output', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```katex\nx^2 + y^2 = z^2\n```\n\n```math\nE = mc^2\n```')

    const cards = wrapper.findAll('[data-vcp-card="katex"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].find('.katex').exists()).toBe(true)
    expect(cards[0].element.textContent).toContain('x^2 + y^2 = z^2')
    expect(cards[1].element.textContent).toContain('E = mc^2')
    expect(cards[0].find('[data-vcp-action="height"]').exists()).toBe(false)
    expect(katexMock.renderToString).toHaveBeenCalled()
  })

  it('falls back to a code block with an error note when katex rendering fails', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```katex\nBOOM + \\notacommand\n```')

    expect(wrapper.find('[data-vcp-card]').exists()).toBe(false)
    expect(wrapper.find('.vcp-render-fallback-note').exists()).toBe(true)
    expect(wrapper.find('.code-lang').text()).toBe('katex')
    expect(wrapper.find('code.hljs').text()).toContain('BOOM')
  })

  it('does not card ordinary code fences while rendering is on', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer(
      '```ts\nconst snippet = "<html>not a card</html>";\n```\n\n```json\n{"svg":"nope"}\n```',
    )

    expect(wrapper.find('[data-vcp-card]').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    const langs = wrapper.findAll('.code-lang').map(node => node.text())
    expect(langs).toEqual(['ts', 'json'])
  })

  it('collapses and re-expands a card from its header button', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```html\n<p>x</p>\n```')
    const card = wrapper.get('[data-vcp-card="html"]')
    expect(card.attributes('data-vcp-collapsed')).toBe('false')

    await card.get('[data-vcp-action="toggle"]').trigger('click')
    expect(card.attributes('data-vcp-collapsed')).toBe('true')

    await card.get('[data-vcp-action="toggle"]').trigger('click')
    expect(card.attributes('data-vcp-collapsed')).toBe('false')
  })

  it('cycles the fixed body height from its header button', async () => {
    useVcpPrefsStore(pinia).setRenderEnabled(true)
    const wrapper = mountRenderer('```html\n<p>x</p>\n```')
    const card = wrapper.get('[data-vcp-card="html"]')
    expect(card.attributes('data-vcp-height-step')).toBe('0')

    await card.get('[data-vcp-action="height"]').trigger('click')
    expect(card.attributes('data-vcp-height-step')).toBe('1')
    await card.get('[data-vcp-action="height"]').trigger('click')
    await card.get('[data-vcp-action="height"]').trigger('click')
    expect(card.attributes('data-vcp-height-step')).toBe('0')
  })
})

describe('ChatPanel exposes the VCP toggles', () => {
  it('wires both header toggles to the persisted vcp prefs store', () => {
    const source = readChatPanelSource()

    expect(source).toContain('useVcpPrefsStore')
    expect(source).toContain('vcp-render-toggle')
    expect(source).toContain('vcp-aesthetic-toggle')
    expect(source).toContain('toggleVcpRender')
    expect(source).toContain('vcpPrefsStore.toggleAestheticEnabled')
    expect(source).toContain('chat.vcp.renderToggle')
    expect(source).toContain('chat.vcp.aestheticToggle')
  })
})

function readChatPanelSource(): string {
  // Keep this test in the established ChatPanel source-assertion style.
  return readFileSync('packages/client/src/components/hermes/chat/ChatPanel.vue', 'utf8')
}
