// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  VCP_BODY_HEIGHTS_PX,
  VCP_HEIGHT_STEPS,
  applyVcpCardAction,
  decodeVcpPayload,
  encodeVcpPayload,
  mountVcpCardFrames,
  renderVcpCardPlaceholder,
  vcpCardTypeFromFence,
  wrapSvgDocument,
  type VcpCardLabels,
} from '@/components/hermes/chat/vcpCards'

const labels: VcpCardLabels = {
  typeLabel: 'HTML',
  sourceLabel: 'msg-42',
  collapseLabel: 'Collapse card',
  heightLabel: 'Adjust card height',
}

describe('vcp fence type detection', () => {
  it('maps explicit vcp fence languages to card types', () => {
    expect(vcpCardTypeFromFence('html')).toBe('html')
    expect(vcpCardTypeFromFence('svg')).toBe('svg')
    expect(vcpCardTypeFromFence('mermaid')).toBe('mermaid')
    expect(vcpCardTypeFromFence('katex')).toBe('katex')
    expect(vcpCardTypeFromFence('math')).toBe('katex')
  })

  it('is case-insensitive and ignores fence info suffixes', () => {
    expect(vcpCardTypeFromFence('HTML')).toBe('html')
    expect(vcpCardTypeFromFence('Mermaid title="flow"')).toBe('mermaid')
    expect(vcpCardTypeFromFence('svg  responsive')).toBe('svg')
  })

  it('does not misdetect ordinary code fence languages', () => {
    expect(vcpCardTypeFromFence('ts')).toBeNull()
    expect(vcpCardTypeFromFence('js')).toBeNull()
    expect(vcpCardTypeFromFence('md')).toBeNull()
    expect(vcpCardTypeFromFence('latex')).toBeNull()
    expect(vcpCardTypeFromFence('tex')).toBeNull()
    expect(vcpCardTypeFromFence('xml')).toBeNull()
    expect(vcpCardTypeFromFence('htmlmixed')).toBeNull()
    expect(vcpCardTypeFromFence('svgz')).toBeNull()
    expect(vcpCardTypeFromFence('mathematica')).toBeNull()
    expect(vcpCardTypeFromFence('')).toBeNull()
    expect(vcpCardTypeFromFence(undefined)).toBeNull()
  })
})

describe('vcp card placeholder', () => {
  it('renders card chrome with type, source message, and action buttons', () => {
    const html = renderVcpCardPlaceholder('html', labels, {
      frameType: 'html',
      payload: encodeVcpPayload('<p>hi</p>'),
      frameTitle: 'HTML card preview',
    })

    expect(html).toContain('data-vcp-card="html"')
    expect(html).toContain('data-vcp-collapsed="false"')
    expect(html).toContain('data-vcp-height-step="0"')
    expect(html).toContain('>HTML</span>')
    expect(html).toContain('msg-42')
    expect(html).toContain('data-vcp-action="height"')
    expect(html).toContain('data-vcp-action="toggle"')
    expect(html).toContain(`data-vcp-payload="${encodeVcpPayload('<p>hi</p>')}"`)
    expect(html).toContain('data-vcp-frame="html"')
    expect(html).not.toContain('<iframe')
  })

  it('renders pre-rendered body html without a frame slot and omits the height button on request', () => {
    const html = renderVcpCardPlaceholder('katex', { ...labels, typeLabel: 'KaTeX' }, {
      bodyHtml: '<div class="latex-block">x</div>',
      withHeight: false,
    })

    expect(html).toContain('data-vcp-card="katex"')
    expect(html).toContain('<div class="latex-block">x</div>')
    expect(html).not.toContain('data-vcp-frame')
    expect(html).not.toContain('data-vcp-action="height"')
    expect(html).toContain('data-vcp-action="toggle"')
  })

  it('escapes the source label so message ids cannot inject markup', () => {
    const html = renderVcpCardPlaceholder('svg', {
      ...labels,
      sourceLabel: 'msg-1"><img src=x onerror=alert(1)>',
    }, { frameType: 'svg' })

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})

describe('sandboxed iframe hydration', () => {
  function slotContainer(frameType: 'html' | 'svg', payload: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = renderVcpCardPlaceholder(frameType === 'html' ? 'html' : 'svg', labels, {
      frameType,
      payload,
      frameTitle: `${frameType} card preview`,
    })
    return root
  }

  it('gives html cards a script-allowed but origin-isolated sandbox', () => {
    const root = slotContainer('html', encodeVcpPayload('<p>hello</p><script>void 0</script>'))
    mountVcpCardFrames(root)

    const iframe = root.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const sandbox = iframe!.getAttribute('sandbox') ?? ''
    expect(sandbox.split(/\s+/)).toContain('allow-scripts')
    expect(sandbox.split(/\s+/)).not.toContain('allow-same-origin')
    expect(iframe!.srcdoc).toContain('<p>hello</p>')
    expect(root.querySelector('[data-vcp-frame]')?.getAttribute('data-vcp-mounted')).toBe('true')
  })

  it('renders svg cards in a fully sandboxed iframe without scripts', () => {
    const root = slotContainer('svg', encodeVcpPayload('<svg><circle r="1"/></svg>'))
    mountVcpCardFrames(root)

    const iframe = root.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const sandbox = iframe!.getAttribute('sandbox') ?? ''
    expect(sandbox).toBe('')
    expect(sandbox.split(/\s+/)).not.toContain('allow-scripts')
    expect(sandbox.split(/\s+/)).not.toContain('allow-same-origin')
    expect(iframe!.srcdoc).toBe(wrapSvgDocument('<svg><circle r="1"/></svg>'))
    expect(iframe!.srcdoc).toContain('<svg><circle r="1"/></svg>')
  })

  it('never mounts the same slot twice and skips empty payloads', () => {
    const root = slotContainer('html', '')
    mountVcpCardFrames(root)
    expect(root.querySelector('iframe')).toBeNull()
    expect(root.querySelector('.vcp-card-frame-slot--empty')).not.toBeNull()

    const filled = slotContainer('html', encodeVcpPayload('<p>x</p>'))
    mountVcpCardFrames(filled)
    mountVcpCardFrames(filled)
    expect(filled.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('skips oversized payloads instead of framing them', () => {
    const root = slotContainer('html', encodeVcpPayload('x'.repeat(20_001)))
    mountVcpCardFrames(root)
    expect(root.querySelector('iframe')).toBeNull()
    expect(root.querySelector('.vcp-card-frame-slot--empty')).not.toBeNull()
  })
})

describe('card actions', () => {
  function card(): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = renderVcpCardPlaceholder('html', labels, { frameType: 'html' })
    return root.querySelector('[data-vcp-card]') as HTMLElement
  }

  it('toggles collapse state', () => {
    const element = card()
    expect(element.dataset.vcpCollapsed).toBe('false')
    expect(applyVcpCardAction(element, 'toggle')).toBe('toggle')
    expect(element.dataset.vcpCollapsed).toBe('true')
    expect(applyVcpCardAction(element, 'toggle')).toBe('toggle')
    expect(element.dataset.vcpCollapsed).toBe('false')
  })

  it('cycles the fixed height steps', () => {
    const element = card()
    expect(applyVcpCardAction(element, 'height')).toBe('height')
    expect(element.dataset.vcpHeightStep).toBe('1')
    expect(applyVcpCardAction(element, 'height')).toBe('height')
    expect(element.dataset.vcpHeightStep).toBe('2')
    expect(applyVcpCardAction(element, 'height')).toBe('height')
    expect(element.dataset.vcpHeightStep).toBe('0')
    expect(VCP_HEIGHT_STEPS).toBe(VCP_BODY_HEIGHTS_PX.length)
  })

  it('ignores unknown actions', () => {
    const element = card()
    expect(applyVcpCardAction(element, 'export')).toBeNull()
    expect(element.dataset.vcpCollapsed).toBe('false')
  })
})

describe('payload helpers', () => {
  it('round-trips sources with quotes and newlines', () => {
    const source = '<p>"quoted" & \'single\'</p>\n<script>void 0</script>'
    expect(decodeVcpPayload(encodeVcpPayload(source))).toBe(source)
  })

  it('returns an empty string for malformed payloads', () => {
    expect(decodeVcpPayload('%')).toBe('')
    expect(decodeVcpPayload(null)).toBe('')
    expect(decodeVcpPayload(undefined)).toBe('')
  })
})
