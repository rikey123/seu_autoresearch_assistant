// The template paper seeded into new LaTeX documents. The .tex file under
// templates/ is the canonical copy; tests compile it through the stub and the
// real tectonic engine, and this module serves it as the create default.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FALLBACK_TEMPLATE = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Hello from the research LaTeX service.',
  '\\end{document}',
  '',
].join('\n')

let cached: string | null = null

export function defaultPaperSource(): string {
  if (cached === null) {
    try {
      cached = readFileSync(join(__dirname, 'templates', 'default-paper.tex'), 'utf8')
    } catch {
      cached = FALLBACK_TEMPLATE
    }
  }
  return cached
}
