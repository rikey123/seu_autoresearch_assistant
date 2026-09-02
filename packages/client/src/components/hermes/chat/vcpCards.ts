import { getFenceLanguage, MERMAID_MAX_SOURCE_LENGTH } from './mermaidRenderer'

export type VcpCardType = 'html' | 'svg' | 'mermaid' | 'katex'

export const VCP_HEIGHT_STEPS = 3
// Body heights (px) per step, matching the .vcp-card-body[data-vcp-height-step] CSS.
export const VCP_BODY_HEIGHTS_PX = [320, 520, 760] as const

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Map a fenced-code language to its VCP card type. Only explicit vcp fence
// languages become cards — plain code blocks (ts, js, latex, tex, …) must not
// be misdetected.
export function vcpCardTypeFromFence(info: string | undefined): VcpCardType | null {
  const lang = getFenceLanguage(info)
  if (lang === 'html') return 'html'
  if (lang === 'svg') return 'svg'
  if (lang === 'mermaid') return 'mermaid'
  if (lang === 'katex' || lang === 'math') return 'katex'
  return null
}

export function encodeVcpPayload(source: string): string {
  return encodeURIComponent(source)
}

export function decodeVcpPayload(encoded: string | null | undefined): string {
  if (!encoded) return ''
  try {
    return decodeURIComponent(encoded)
  } catch {
    return ''
  }
}

export interface VcpCardLabels {
  typeLabel: string
  sourceLabel: string
  collapseLabel: string
  heightLabel: string
}

interface VcpCardOptions {
  bodyHtml?: string
  frameType?: 'html' | 'svg'
  payload?: string
  frameTitle?: string
  withHeight?: boolean
}

// Build the static chrome of a card (header with type + source message and the
// collapse/height actions) around either an iframe slot (html/svg, hydrated
// after mount) or pre-rendered body HTML (mermaid/katex).
export function renderVcpCardPlaceholder(
  type: VcpCardType,
  labels: VcpCardLabels,
  options: VcpCardOptions = {},
): string {
  const parts = [
    `<div class="vcp-card" data-vcp-card="${type}" data-vcp-collapsed="false" data-vcp-height-step="0">`,
    '<div class="vcp-card-header">',
    `<span class="vcp-card-type">${escapeHtml(labels.typeLabel)}</span>`,
  ]
  if (labels.sourceLabel) {
    parts.push(`<span class="vcp-card-source">${escapeHtml(labels.sourceLabel)}</span>`)
  }
  parts.push('<span class="vcp-card-actions">')
  if (options.withHeight !== false) {
    parts.push(
      `<button type="button" class="vcp-card-btn" data-vcp-action="height" title="${escapeHtml(labels.heightLabel)}" aria-label="${escapeHtml(labels.heightLabel)}">`,
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '<polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />',
      '</svg></button>',
    )
  }
  parts.push(
    `<button type="button" class="vcp-card-btn" data-vcp-action="toggle" title="${escapeHtml(labels.collapseLabel)}" aria-label="${escapeHtml(labels.collapseLabel)}">`,
    '<svg class="vcp-card-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
    '<polyline points="6 9 12 15 18 9" />',
    '</svg></button>',
  )
  parts.push('</span>')
  parts.push('</div>')
  parts.push('<div class="vcp-card-body">')
  if (options.frameType) {
    parts.push(
      `<div class="vcp-card-frame-slot" data-vcp-frame="${options.frameType}"`,
      ` data-vcp-title="${escapeHtml(options.frameTitle || options.frameType)}"`,
      options.payload ? ` data-vcp-payload="${escapeHtml(options.payload)}"` : '',
      '></div>',
    )
  }
  if (options.bodyHtml) {
    parts.push(options.bodyHtml)
  }
  parts.push('</div>')
  parts.push('</div>')
  return parts.join('')
}

// SVG cards are rendered inside a fully sandboxed iframe (sandbox="") instead
// of being sanitized inline: an empty sandbox keeps the document in an opaque
// origin AND blocks scripts, so SVG event handlers and embedded <script> can
// never run, while hand-rolled sanitization of the whole SVG feature surface
// (foreignObject, <script> in <defs>, event attributes, …) would be far too
// easy to get wrong without adding a sanitizer dependency.
export function wrapSvgDocument(source: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<style>html,body{margin:0;padding:0;background:transparent;overflow:auto}',
    'svg{max-width:100%;height:auto;display:block;margin:0 auto}</style>',
    `</head><body>${source}</body></html>`,
  ].join('')
}

// Build and attach the sandboxed iframe for an html/svg card slot.
// SECURITY: the sandbox attribute never includes allow-same-origin, so the
// framed document always stays in an opaque origin with no access to the app's
// DOM, storage, or cookies. html cards may run scripts (allow-scripts) but
// remain isolated; svg cards run nothing at all.
export function mountVcpCardFrames(root: HTMLElement): void {
  const slots = root.querySelectorAll<HTMLElement>('[data-vcp-frame]:not([data-vcp-mounted="true"])')
  for (const slot of slots) {
    const type = slot.dataset.vcpFrame
    if (type !== 'html' && type !== 'svg') continue
    const source = decodeVcpPayload(slot.dataset.vcpPayload)
    if (!source || source.length > MERMAID_MAX_SOURCE_LENGTH) {
      slot.dataset.vcpMounted = 'true'
      slot.classList.add('vcp-card-frame-slot--empty')
      continue
    }
    const iframe = document.createElement('iframe')
    iframe.className = 'vcp-card-frame'
    iframe.setAttribute('sandbox', type === 'html' ? 'allow-scripts' : '')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.setAttribute('loading', 'lazy')
    iframe.setAttribute('title', slot.dataset.vcpTitle || type)
    iframe.srcdoc = type === 'svg' ? wrapSvgDocument(source) : source
    slot.dataset.vcpMounted = 'true'
    slot.appendChild(iframe)
  }
}

export type VcpCardActionResult = 'toggle' | 'height' | null

// Click-delegated card action: collapse/expand and height cycling. Buttons live
// in the card header, so clicks inside the sandboxed iframe never reach this.
export function applyVcpCardAction(card: HTMLElement, action: string | undefined): VcpCardActionResult {
  if (action === 'toggle') {
    const collapsed = card.dataset.vcpCollapsed === 'true'
    card.dataset.vcpCollapsed = collapsed ? 'false' : 'true'
    return 'toggle'
  }
  if (action === 'height') {
    const current = Number.parseInt(card.dataset.vcpHeightStep || '0', 10)
    const next = Number.isFinite(current) ? current : 0
    card.dataset.vcpHeightStep = String((next + 1) % VCP_HEIGHT_STEPS)
    return 'height'
  }
  return null
}
