import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  LATEX_EDITOR_FONT_SIZE_PX,
  LATEX_EDITOR_LINE_HEIGHT_PX,
  LATEX_EDITOR_PADDING_BLOCK_PX,
  LATEX_EDITOR_PADDING_INLINE_PX,
  LATEX_HIGHLIGHT_MAX_SOURCE_LENGTH,
  renderLatexHighlight,
} from '@/views/research/latexHighlight'

const BACKSLASH = String.fromCharCode(92)
const VIEW_FILE = join(
  process.cwd(),
  'packages',
  'client',
  'src',
  'views',
  'research',
  'ResearchLatexView.vue',
)

function latexLine(command: string): string {
  return `${BACKSLASH}${command}`
}

// Extracts the body of a top-level SCSS block (brace-matched, so nested
// :deep(...) rules are handled) to assert the overlay and the textarea stay
// metric-identical with the constants exported by latexHighlight.ts.
function extractScssBlock(source: string, selector: string): string {
  const selectorStart = source.indexOf(`${selector} {`)
  if (selectorStart < 0) return ''
  const bodyStart = source.indexOf('{', selectorStart)
  let depth = 0
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(bodyStart + 1, i)
    }
  }
  return ''
}

describe('renderLatexHighlight', () => {
  it('wraps commands, comments, math delimiters and environments in token spans', () => {
    const source = [
      `${latexLine('documentclass')}{article}`,
      '% a setup note',
      `${latexLine('begin')}{document}`,
      'Cost $x + y$ units.',
      `${latexLine('end')}{document}`,
    ].join('\n')

    const html = renderLatexHighlight(source)

    expect(html).toContain(`<span class="hljs-keyword">${latexLine('documentclass')}</span>`)
    expect(html).toContain(`<span class="hljs-keyword">${latexLine('begin')}</span>`)
    expect(html).toContain(`<span class="hljs-keyword">${latexLine('end')}</span>`)
    expect(html).toContain('<span class="hljs-comment">% a setup note</span>')
    expect(html).toContain('<span class="hljs-built_in">$</span>')
  })

  it('escapes hostile source instead of emitting raw HTML (no XSS)', () => {
    const html = renderLatexHighlight('<script>alert(1)</script>')

    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes hostile content nested inside a token span', () => {
    const html = renderLatexHighlight(`% <img src=x onerror="alert(1)"> ${latexLine('textbf')}{<script>}`)

    expect(html).toContain('<span class="hljs-comment">')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('pads a trailing newline so overlay and textarea scroll heights match', () => {
    expect(renderLatexHighlight('hello')).toBe('hello')
    expect(renderLatexHighlight('hello\n').endsWith('hello\n\n')).toBe(true)
    expect(renderLatexHighlight('')).toBe('')
  })

  it('keeps the degradation threshold at 200 KB', () => {
    expect(LATEX_HIGHLIGHT_MAX_SOURCE_LENGTH).toBe(200 * 1024)
  })
})

describe('LaTeX editor pixel parity', () => {
  const vueSource = readFileSync(VIEW_FILE, 'utf8')

  it('declares identical font and padding metrics on the overlay and the textarea', () => {
    for (const selector of ['.latex-highlight-layer', '.latex-source']) {
      const block = extractScssBlock(vueSource, selector)
      expect(block, `${selector} block exists`).not.toBe('')
      expect(block).toContain(`font-size: ${LATEX_EDITOR_FONT_SIZE_PX}px`)
      expect(block).toContain(`line-height: ${LATEX_EDITOR_LINE_HEIGHT_PX}px`)
      expect(block).toContain(`padding-block: ${LATEX_EDITOR_PADDING_BLOCK_PX}px`)
      expect(block).toContain(`padding-inline: ${LATEX_EDITOR_PADDING_INLINE_PX}px`)
    }
  })

  it('keeps the textarea glyphs transparent with a visible caret and readable selection', () => {
    const textareaBlock = extractScssBlock(vueSource, '.latex-source')
    expect(textareaBlock).toContain('color: transparent')
    expect(textareaBlock).toContain('caret-color:')
    expect(textareaBlock).toContain('::selection')
  })
})
