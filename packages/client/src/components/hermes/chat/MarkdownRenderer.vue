<script setup lang="ts">
import 'katex/dist/katex.min.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import type MarkdownIt from 'markdown-it'
import MarkdownItConstructor from 'markdown-it'
import katex from 'katex'
import markdownItKatex from '@vscode/markdown-it-katex'
import { handleCodeBlockCopyClick, renderHighlightedCodeBlock } from './highlight'
import { repairNestedMarkdownFences } from './markdownFenceRepair'
import {
  MERMAID_MAX_DIAGRAMS_PER_MESSAGE,
  MERMAID_MAX_SOURCE_LENGTH,
  MERMAID_RENDER_TIMEOUT_MS,
  decodeMermaidSource,
  isMermaidFence,
  renderMermaidPlaceholder,
} from './mermaidRenderer'
import {
  applyVcpCardAction,
  encodeVcpPayload,
  mountVcpCardFrames,
  renderVcpCardPlaceholder,
  vcpCardTypeFromFence,
  type VcpCardLabels,
  type VcpCardType,
} from './vcpCards'
import { useVcpPrefsStore } from '@/stores/hermes/vcp-prefs'
import { downloadFile, getDownloadUrl, inferDownloadFileName } from '@/api/studio/download'
import { isPreviewableFile } from '@/utils/hermes/file-preview'
import { openUrlInDesktopBrowser } from '@/utils/desktop-browser'

const LATEX_FENCE_LANGS = new Set(['latex', 'tex', 'math', 'katex'])
function getFenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

function isLatexFence(info: string): boolean {
  return LATEX_FENCE_LANGS.has(getFenceLanguage(info))
}

function normalizeLatexFenceContent(content: string): string {
  const trimmed = content.trim()

  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
    return trimmed.slice(2, -2).trim()
  }

  if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
    return trimmed.slice(2, -2).trim()
  }

  if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) {
    return trimmed.slice(2, -2).trim()
  }

  return trimmed
}

function renderLatexFence(content: string): string {
  const latex = normalizeLatexFenceContent(content)
  return `<div class="latex-block">${katex.renderToString(latex, {
    displayMode: true,
    output: 'htmlAndMathml',
    throwOnError: false,
    strict: 'ignore',
  })}</div>`
}

const props = withDefaults(defineProps<{
    content: string
    mentionNames?: string[]
    headingIdPrefix?: string
}>(), {
    mentionNames: () => [],
    headingIdPrefix: '',
})

const { t } = useI18n()
const message = useMessage()

function diffFoldLabel(hiddenCount: number): string {
  return t('chat.unchangedLines', { count: hiddenCount })
}

// VCP card layer (html/svg/mermaid/katex fences rendered as sandboxed cards).
// The toggle defaults to off, which keeps the pre-VCP rendering behavior.
const vcpPrefs = useVcpPrefsStore()
const vcpRenderEnabled = computed(() => vcpPrefs.renderEnabled)
const vcpAestheticEnabled = computed(() => vcpPrefs.aestheticEnabled)

const VCP_CARD_TYPE_LABEL_KEYS: Record<VcpCardType, string> = {
  html: 'chat.vcp.typeHtml',
  svg: 'chat.vcp.typeSvg',
  mermaid: 'chat.vcp.typeMermaid',
  katex: 'chat.vcp.typeKatex',
}

function vcpCardSourceLabel(): string {
  // The heading-id prefix carries the message id (msg-<id>), so each card
  // names the message it was rendered from.
  return props.headingIdPrefix
}

function vcpCardLabels(type: VcpCardType): VcpCardLabels {
  return {
    typeLabel: t(VCP_CARD_TYPE_LABEL_KEYS[type]),
    sourceLabel: vcpCardSourceLabel(),
    collapseLabel: t('chat.vcp.collapse'),
    heightLabel: t('chat.vcp.changeHeight'),
  }
}

function renderVcpFallbackNote(noteKey: string, code: string, lang: string): string {
  return [
    `<div class="vcp-render-fallback-note">${t(noteKey)}</div>`,
    renderHighlightedCodeBlock(code, lang, t('common.copy')),
  ].join('')
}

function renderKatexCard(content: string): string {
  try {
    return renderVcpCardPlaceholder('katex', vcpCardLabels('katex'), {
      bodyHtml: renderLatexFence(content),
      withHeight: false,
    })
  } catch {
    return renderVcpFallbackNote('chat.vcp.katexFailed', content, 'katex')
  }
}

const md: MarkdownIt = new MarkdownItConstructor({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    return renderHighlightedCodeBlock(str, lang, t('common.copy'), {
      formatDiffFoldLabel: diffFoldLabel,
    })
  },
})

// Preserve literal quote characters from user and assistant messages while
// retaining typographer's other replacements (for example, dashes and ellipses).
md.disable('smartquotes')

md.use(markdownItKatex, {
  katex,
  throwOnError: false,
  strict: 'ignore',
})

// A conversation carries whatever language the person writes in, and one
// message can hold both. dir="auto" lets each block pick its own direction from
// its first strong character, so an Arabic paragraph reads right-to-left even
// while the interface is in English — and the reverse.
const AUTO_DIRECTION_TOKENS = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'list_item_open',
  'th_open',
  'td_open',
  'dt_open',
  'dd_open',
])

md.core.ruler.push('auto_direction', (state) => {
  for (const token of state.tokens) {
    if (AUTO_DIRECTION_TOKENS.has(token.type)) token.attrSet('dir', 'auto')
  }
})

const defaultFenceRenderer = md.renderer.rules.fence?.bind(md.renderer.rules)

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const cardType = vcpRenderEnabled.value ? vcpCardTypeFromFence(token.info) : null

  if (cardType === 'katex') {
    return renderKatexCard(token.content)
  }

  if (cardType === 'mermaid') {
    return renderVcpCardPlaceholder('mermaid', vcpCardLabels('mermaid'), {
      bodyHtml: renderMermaidPlaceholder(token.content),
    })
  }

  if (cardType === 'html' || cardType === 'svg') {
    return renderVcpCardPlaceholder(cardType, vcpCardLabels(cardType), {
      frameType: cardType,
      payload: encodeVcpPayload(token.content),
      frameTitle: t('chat.vcp.frameTitle', { type: t(VCP_CARD_TYPE_LABEL_KEYS[cardType]) }),
    })
  }

  if (isLatexFence(token.info)) {
    return renderLatexFence(token.content)
  }

  if (isMermaidFence(token.info)) {
    return renderMermaidPlaceholder(token.content)
  }

  if (defaultFenceRenderer) {
    return defaultFenceRenderer(tokens, idx, options, env, self)
  }

  return self.renderToken(tokens, idx, options)
}

const markdownBody = ref<HTMLElement | null>(null)
const componentId = `hermes-mermaid-${Math.random().toString(36).slice(2)}`
const previewUrl = ref<string | null>(null)

let renderGeneration = 0
let unmounted = false

function isLocalFilePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

function normalizeLocalFilePath(path: string): string {
  return /^[a-zA-Z]:\\/.test(path) ? path.replace(/\\/g, '/') : path
}

function localFilePathWithoutLocation(path: string): string {
  const normalizedPath = normalizeLocalFilePath(path)
  const locationMatch = normalizedPath.match(/^(.*?):(\d+)(?::\d+)?$/)
  if (!locationMatch || !isLocalFilePath(locationMatch[1])) return normalizedPath
  return locationMatch[1]
}

function requestWorkspaceFilePreview(path: string, fileName: string): boolean {
  const event = new CustomEvent('hermes:preview-workspace-file', {
    cancelable: true,
    detail: { path, fileName },
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

function downloadPathFromUrl(url: string): string | null {
  try {
    return new URL(url, window.location.origin).searchParams.get('path')
  } catch {
    return null
  }
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])

function hasExtension(path: string, extensions: Set<string>): boolean {
  const clean = path.split('?')[0].split('#')[0]
  const ext = clean.split('.').pop()?.toLowerCase()
  return !!ext && extensions.has(ext)
}

const renderedHtml = computed(() => {
  let html = md.render(repairNestedMarkdownFences(props.content))

  // Add IDs to headings for anchor links
  const prefix = props.headingIdPrefix ? `${props.headingIdPrefix}-` : ''
  let headingCounter = 0
  // Match any h1-h6 tags, with or without attributes
  html = html.replace(/<(h[1-6])([^>]*)>/g, (match, tag, attrs) => {
    headingCounter++
    const id = `${prefix}heading-${headingCounter}`
    
    // Check if id attribute already exists
    if (attrs.includes('id=')) {
      // Replace existing id
      return match.replace(/id="[^"]*"/, `id="${id}"`).replace(/id='[^']*'/, `id="${id}"`)
    }
    
    // Add new id
    if (attrs.trim() === '') {
      return `<${tag} id="${id}">`
    }
    return `<${tag} ${attrs.trim()} id="${id}">`
  })

  // Replace image src paths with download URLs
  html = html.replace(/\bsrc=(["'])([^"']+)\1/g, (match, quote, path) => {
    if (!isLocalFilePath(path)) return match
    const downloadUrl = getDownloadUrl(normalizeLocalFilePath(path))
    return `src=${quote}${downloadUrl}${quote}`
  })

  // Replace local file links with file card UI or video player
  // Match <a href="/tmp/file.pdf">filename</a> or <a href="C:/tmp/file.pdf">filename</a>
  html = html.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, (match, rawPath, filename) => {
    if (!isLocalFilePath(rawPath)) return match

    const path = localFilePathWithoutLocation(downloadPathFromUrl(rawPath) || rawPath)
    const fileName = filename.trim()
    const downloadName = inferDownloadFileName(path, fileName)

    // Video files: render as video player
    if (hasExtension(path, VIDEO_EXTENSIONS)) {
      const downloadUrl = getDownloadUrl(path)
      return `<div class="markdown-video-container">
        <video class="markdown-video" controls preload="metadata" src="${downloadUrl}"></video>
        <div class="markdown-video-footer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span class="att-name">${fileName}</span>
        </div>
      </div>`
    }

    // Audio files: render as inline audio player
    if (hasExtension(path, AUDIO_EXTENSIONS)) {
      const downloadUrl = getDownloadUrl(path)
      return `<div class="markdown-audio-container">
        <audio class="markdown-audio" controls preload="metadata" src="${downloadUrl}"></audio>
        <div class="markdown-audio-footer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span class="att-name">${fileName}</span>
        </div>
      </div>`
    }

    // Other files: render as file card
    return `<div class="markdown-file-card" data-path="${path}" data-filename="${downloadName}" title="${t('download.downloadFile')}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span class="att-name">${fileName}</span>
      <button class="att-download-btn" type="button" title="${t('download.downloadFile')}" aria-label="${t('download.downloadFile')}">
        <svg class="att-download-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>`
  })

  if (props.mentionNames && props.mentionNames.length > 0) {
    const escaped = [...props.mentionNames]
      .sort((a, b) => b.length - a.length)
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`(?<=[\\s>({\\[<]|^)@(${escaped.join('|')})(?=[\\s.,!?;:，。！？；：)\\]}>]|<|$)`, 'gi')
    html = html.replace(re, '<span class="mention-highlight">@$1</span>')
  }
  return html
})

function renderMermaidFallback(element: HTMLElement, source: string): void {
  element.outerHTML = renderVcpFallbackNote('chat.vcp.mermaidFailed', source, 'mermaid')
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  })
}

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  let current: HTMLElement | null = el.parentElement
  while (current) {
    const { overflow, overflowY } = getComputedStyle(current)
    if (overflow === 'auto' || overflow === 'scroll' || overflowY === 'auto' || overflowY === 'scroll') {
      return current
    }
    current = current.parentElement
  }
  return null
}

function isNearScrollBottom(el: HTMLElement, threshold = 200): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

function cleanupMermaidRenderArtifacts(id: string): void {
  document.getElementById(id)?.remove()
  document.getElementById(`d${id}`)?.remove()
}

async function renderMermaidDiagrams(): Promise<void> {
  const generation = ++renderGeneration
  await nextTick()

  const root = markdownBody.value
  if (unmounted || generation !== renderGeneration || !root) return

  const pendingDiagrams = Array.from(root.querySelectorAll<HTMLElement>('[data-mermaid-pending="true"]'))
  if (pendingDiagrams.length === 0) return

  const diagramsToRender = pendingDiagrams.slice(0, MERMAID_MAX_DIAGRAMS_PER_MESSAGE)
  const diagramsToFallback = pendingDiagrams.slice(MERMAID_MAX_DIAGRAMS_PER_MESSAGE)

  for (const element of diagramsToFallback) {
    renderMermaidFallback(element, decodeMermaidSource(element.getAttribute('data-mermaid-source')))
  }

  const renderCandidates = diagramsToRender
    .map(element => ({
      element,
      source: decodeMermaidSource(element.getAttribute('data-mermaid-source')),
    }))

  const validDiagrams = [] as typeof renderCandidates
  for (const candidate of renderCandidates) {
    if (unmounted || generation !== renderGeneration || !root.contains(candidate.element)) return

    if (!candidate.source || candidate.source.length > MERMAID_MAX_SOURCE_LENGTH) {
      renderMermaidFallback(candidate.element, candidate.source)
      continue
    }

    validDiagrams.push(candidate)
  }

  if (validDiagrams.length === 0) return

  let mermaid: typeof import('mermaid').default

  try {
    mermaid = (await withTimeout(import('mermaid'), MERMAID_RENDER_TIMEOUT_MS, 'Mermaid import')).default
    if (unmounted || generation !== renderGeneration) return

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
    })
  } catch {
    if (unmounted || generation !== renderGeneration) return
    for (const { element, source } of validDiagrams) {
      if (root.contains(element)) {
        renderMermaidFallback(element, source)
      }
    }
    return
  }

  for (const [index, { element, source }] of validDiagrams.entries()) {
    if (unmounted || generation !== renderGeneration || !root.contains(element)) return

    try {
      const id = `${componentId}-${generation}-${index}`
      const result = await withTimeout(mermaid.render(id, source), MERMAID_RENDER_TIMEOUT_MS, 'Mermaid render')
      cleanupMermaidRenderArtifacts(id)
      if (unmounted || generation !== renderGeneration || !root.contains(element)) return

      const scrollParent = getScrollParent(markdownBody.value)
      const shouldKeepBottom = scrollParent ? isNearScrollBottom(scrollParent) : false
      element.removeAttribute('data-mermaid-pending')
      element.removeAttribute('data-mermaid-source')
      element.innerHTML = result.svg
      if (scrollParent && shouldKeepBottom) {
        nextTick(() => {
          scrollParent.scrollTop = scrollParent.scrollHeight
        })
      }
    } catch {
      cleanupMermaidRenderArtifacts(`${componentId}-${generation}-${index}`)
      if (unmounted || generation !== renderGeneration || !root.contains(element)) return
      renderMermaidFallback(element, source)
    }
  }
}

onMounted(() => {
  if (markdownBody.value) mountVcpCardFrames(markdownBody.value)
  void renderMermaidDiagrams()
})

watch(renderedHtml, () => {
  if (markdownBody.value) mountVcpCardFrames(markdownBody.value)
  void renderMermaidDiagrams()
}, { flush: 'post' })

onBeforeUnmount(() => {
  unmounted = true
  renderGeneration += 1
})

async function handleMarkdownClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement

  // VCP card chrome (collapse/height) is handled first; clicks inside the
  // sandboxed iframe never bubble here because of the opaque origin.
  const vcpActionButton = target.closest<HTMLElement>('[data-vcp-action]')
  if (vcpActionButton) {
    event.preventDefault()
    event.stopPropagation()
    const card = vcpActionButton.closest<HTMLElement>('[data-vcp-card]')
    if (card) applyVcpCardAction(card, vcpActionButton.dataset.vcpAction)
    return
  }

  const copyResult = await handleCodeBlockCopyClick(event)
  if (copyResult !== null) {
    if (copyResult) {
      message.success(t('common.copied'))
    } else {
      message.error(t('chat.copyFailed'))
    }
    return
  }

  // Handle image clicks for preview
  const img = target.closest('img') as HTMLImageElement | null
  if (img) {
    event.preventDefault()
    previewUrl.value = img.src
    return
  }

  // Handle file card clicks for download
  const fileCard = target.closest('.markdown-file-card') as HTMLElement | null
  if (fileCard) {
    event.preventDefault()
    event.stopPropagation()
    const path = fileCard.getAttribute('data-path')
    const fileName = fileCard.getAttribute('data-filename') || undefined

    const isDownloadBtn = target.closest('.att-download-btn')

    if (isDownloadBtn && path) { // Only download file with download icon clicked.
      message.info(t('download.downloading'))
      downloadFile(path, fileName).catch((err: Error) => {
        message.error(err.message || t('download.downloadFailed'))
      })
      return
    }

    if (path) {
      if (isPreviewableFile(fileName || path) && requestWorkspaceFilePreview(path, fileName || inferDownloadFileName(path))) {
        return
      } else { // Download file immediately
        downloadFile(path, fileName).catch((err: Error) => {
          message.error(err.message || t('download.downloadFailed'))
        })
      }
    }
    return
  }

  // Handle file path link clicks for download
  const link = target.closest('a') as HTMLAnchorElement | null
  if (!link) return

  const href = link.getAttribute('href')
  if (!href) return

  // Desktop chat links stay inside the embedded browser. Web deployments keep
  // using a separate browser tab so the hash-based router cannot intercept.
  if (href.startsWith('http://') || href.startsWith('https://')) {
    event.preventDefault()
    try {
      if (await openUrlInDesktopBrowser(href)) return
    } catch (error) {
      message.error(`${t('browser.loadFailed')}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }

  // Full download URL: open directly (already has /api/studio/files/download?path=...)
  if (href.startsWith('/api/studio/files/download?')) {
    event.preventDefault()
    event.stopPropagation()
    const linkText = link.textContent || ''
    const fileName = linkText.startsWith('File: ') ? linkText.slice(6).trim() : linkText.trim()
    message.info(t('download.downloading'))
    // Parse the real file path from the existing query param
    const url = new URL(href, window.location.origin)
    const realPath = url.searchParams.get('path') || href
    downloadFile(realPath, inferDownloadFileName(realPath, fileName || undefined)).catch((err: Error) => {
      message.error(err.message || t('download.downloadFailed'))
    })
    return
  }

  // File path links: intercept and download
  if (isLocalFilePath(href)) {
    event.preventDefault()
    event.stopPropagation()
    const linkText = link.textContent || ''
    const fileName = linkText.startsWith('File: ') ? linkText.slice(6).trim() : linkText.trim()
    const path = localFilePathWithoutLocation(href)
    message.info(t('download.downloading'))
    downloadFile(path, inferDownloadFileName(path, fileName || undefined)).catch((err: Error) => {
      message.error(err.message || t('download.downloadFailed'))
    })
  }
}

</script>

<template>
  <div
    ref="markdownBody"
    class="markdown-body"
    :class="{ 'vcp-aesthetic': vcpAestheticEnabled }"
    dir="auto"
    v-html="renderedHtml"
    @click="handleMarkdownClick"
  ></div>
  <Teleport to="body">
    <div v-if="previewUrl" class="image-preview-overlay" @click.self="previewUrl = null">
      <img :src="previewUrl" class="image-preview-img" @click="previewUrl = null" />
    </div>
  </Teleport>
</template>

<style lang="scss">
@use '@/styles/variables' as *;

.markdown-body {
  // Code keeps its own direction whatever language surrounds it: a snippet
  // inside an Arabic sentence must not be mirrored.
  pre,
  code,
  kbd,
  samp {
    direction: ltr;
    unicode-bidi: isolate;
    text-align: start;
  }

  font-size: var(--font-size-base);
  line-height: 1.65;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-wrap: anywhere;
  word-break: break-word;

  p {
    margin: 0 0 8px;
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;

    &:last-child {
      margin-bottom: 0;
    }
  }

  ul, ol {
    padding-inline-start: 20px;
    margin: 4px 0 8px;
  }

  li {
    margin: 2px 0;
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  strong {
    color: $text-primary;
    font-weight: 600;
  }

  em {
    color: $text-secondary;
  }

  a {
    color: $accent-primary;
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
    word-break: break-word;

    &:hover {
      color: $accent-hover;
    }
  }

  img {
    display: block;
    max-width: 200px;
    max-height: 160px;
    object-fit: contain;
    cursor: pointer;
    border-radius: 4px;
    margin: 8px 0;
  }

  .markdown-video-container {
    margin: 12px 0;
    border-radius: $radius-sm;
    overflow: hidden;
    background: #000;
    border: 1px solid $border-color;
  }

  .markdown-video {
    display: block;
    width: 100%;
    max-width: 640px;
    max-height: 480px;
    object-fit: contain;
  }

  .markdown-video-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    font-size: 12px;

    .att-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .markdown-audio-container {
    margin: 12px 0;
    padding: 10px 12px;
    border: 1px solid $border-light;
    border-radius: $radius-sm;
    background-color: rgba(0, 0, 0, 0.04);
  }

  .markdown-audio {
    display: block;
    width: 100%;
    max-width: 420px;
  }

  .markdown-audio-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    color: $text-secondary;
    font-size: 12px;

    .att-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .markdown-file-card {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    font-size: 12px;
    color: $text-secondary;
    background-color: rgba(0, 0, 0, 0.04);
    border: 1px solid $border-light;
    border-radius: $radius-sm;
    margin: 8px 0;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.08);
      border-color: $border-color;
    }

    .att-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 160px;
    }

    .att-download-icon {
      flex-shrink: 0;
      opacity: 0.6;
      transition: opacity 0.15s ease;
    }

    .att-download-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      padding: 0;
      color: inherit;
      background: transparent;
      border: 0;
      cursor: pointer;
    }

    &:hover .att-download-icon,
    .att-download-btn:hover .att-download-icon {
      opacity: 1;
    }
  }

  blockquote {
    margin: 8px 0;
    padding: 4px 12px;
    border-inline-start: 3px solid $border-color;
    color: $text-secondary;
  }

  code:not(.hljs) {
    background: $code-bg;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: $font-code;
    font-size: 13px;
    color: $accent-primary;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    display: block;
    overflow-x: auto;

    th, td {
      padding: 6px 12px;
      border: 1px solid $border-color;
      text-align: start;
      font-size: 13px;
    }

    th {
      background: rgba(var(--accent-primary-rgb), 0.08);
      color: $text-primary;
      font-weight: 600;
    }

    td {
      color: $text-secondary;
    }
  }

  hr {
    border: none;
    border-top: 1px solid $border-color;
    margin: 12px 0;
  }

  .mermaid-diagram {
    margin: 10px 0;
    padding: 14px;
    border: 1px solid $border-color;
    border-radius: 8px;
    background: rgba(var(--accent-primary-rgb), 0.04);
    overflow-x: auto;

    svg {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
    }
  }

  .mermaid-loading {
    color: $text-secondary;
    font-size: 13px;
    font-family: $font-code;
    min-height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  // VCP card layer: html/svg/mermaid/katex fences rendered as sandboxed cards.
  .vcp-card {
    margin: 10px 0;
    border: 1px solid $border-color;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.02);
    overflow: hidden;

    .vcp-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-bottom: 1px solid $border-light;
      background: rgba(var(--accent-primary-rgb), 0.05);
      font-size: 11px;
      line-height: 18px;
      color: $text-secondary;
    }

    .vcp-card-type {
      flex-shrink: 0;
      font-family: $font-code;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: $accent-primary;
    }

    .vcp-card-source {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: $text-muted;
    }

    .vcp-card-actions {
      display: inline-flex;
      flex-shrink: 0;
      gap: 2px;
    }

    .vcp-card-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      background: transparent;
      color: $text-secondary;
      cursor: pointer;
      border-radius: 4px;

      &:hover {
        background: rgba(0, 0, 0, 0.06);
        color: $text-primary;
      }
    }

    .vcp-card-chevron {
      transition: transform 0.15s ease;
    }

    &[data-vcp-collapsed='true'] {
      .vcp-card-chevron {
        transform: rotate(-90deg);
      }

      .vcp-card-body {
        display: none;
      }

      .vcp-card-header {
        border-bottom-color: transparent;
      }
    }

    .vcp-card-body {
      height: 320px;
      box-sizing: border-box;
      overflow: auto;
    }

    &[data-vcp-height-step='1'] .vcp-card-body {
      height: 520px;
    }

    &[data-vcp-height-step='2'] .vcp-card-body {
      height: 760px;
    }

    &[data-vcp-card='katex'] .vcp-card-body {
      height: auto;
      overflow: visible;
    }

    .vcp-card-frame-slot {
      width: 100%;
      height: 100%;
      min-height: 60px;
    }

    .vcp-card-frame {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent;
    }

    .mermaid-diagram {
      margin: 0;
      border: none;
      border-radius: 0;
      background: transparent;
    }
  }

  .vcp-render-fallback-note {
    margin: 8px 0 0;
    padding: 3px 8px;
    font-size: 12px;
    color: $warning;
    border-inline-start: 3px solid $warning;
  }

  // Aesthetic toggle: stronger visual separation for rendered artifact cards.
  &.vcp-aesthetic .vcp-card {
    border-color: rgba(var(--accent-primary-rgb), 0.35);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);

    .vcp-card-header {
      background: linear-gradient(
        90deg,
        rgba(var(--accent-primary-rgb), 0.14),
        rgba(var(--accent-primary-rgb), 0.04)
      );
    }
  }
}

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.image-preview-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  cursor: pointer;
}

</style>
