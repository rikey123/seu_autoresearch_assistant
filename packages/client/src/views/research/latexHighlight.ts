import hljs from 'highlight.js'

// Pixel metrics shared by the LaTeX source textarea and the highlight overlay
// rendered behind it. The two layers must align to the pixel, so every metric
// is declared once here: the component's scoped SCSS must hard-code the same
// values, and tests/client/latex-highlight.test.ts asserts the SCSS block
// stays in sync with these constants.
export const LATEX_EDITOR_FONT_SIZE_PX = 13
export const LATEX_EDITOR_LINE_HEIGHT_PX = 21
export const LATEX_EDITOR_PADDING_BLOCK_PX = 10
export const LATEX_EDITOR_PADDING_INLINE_PX = 12

// Above this size highlight.js becomes noticeably slow on every keystroke and
// the overlay DOM grows huge, so the editor falls back to a plain textarea.
export const LATEX_HIGHLIGHT_MAX_SOURCE_LENGTH = 200 * 1024

const LATEX_LANGUAGE = 'latex'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Renders LaTeX source as highlight HTML for the editor overlay. The full
// highlight.js bundle (already shipped for chat code blocks) registers the
// `latex` grammar, which covers commands (\cmd), comments (%), math
// delimiters ($...$) and environment markers (\begin/\end). Its emitter
// escapes every text chunk before wrapping it in token spans, so the output
// is safe for v-html even for hostile source; the try/catch fallback escapes
// manually when the grammar is unavailable.
export function renderLatexHighlight(source: string): string {
  let html: string
  try {
    html = hljs.getLanguage(LATEX_LANGUAGE)
      ? hljs.highlight(source, { language: LATEX_LANGUAGE, ignoreIllegals: true }).value
      : escapeHtml(source)
  } catch {
    html = escapeHtml(source)
  }
  // A textarea paints the empty trailing line after a final newline, while a
  // pre-based overlay collapses it; pad the HTML so both layers keep the same
  // scroll height.
  if (source.endsWith('\n')) html += '\n'
  return html
}
