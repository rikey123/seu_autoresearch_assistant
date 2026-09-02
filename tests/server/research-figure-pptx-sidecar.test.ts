import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Non-gated structure contract of the python-pptx sidecar used by the
// figure-drawing workflow's optional pptx export node. These checks stay
// hermetic (source-level only) except the syntax probe, which skips when no
// Python interpreter is reachable — CI never needs Python. The gated
// round-trip through the real workflow lives in
// research-figure-drawing-e2e.test.ts (HERMES_FIGURE_PPTX_SMOKE=1).
const SIDE_CAR = join(__dirname, '../../packages/server/src/modules/research/workflows/scripts/figure_svg_to_pptx.py')
const source = readFileSync(SIDE_CAR, 'utf8')

function findReachablePython(): string {
  const candidates = [process.env.RESEARCH_FIGURE_PPTX_PYTHON, 'python', 'python3']
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      execFileSync(candidate, ['-c', 'import sys'], { stdio: 'ignore', shell: false })
      return candidate
    } catch {
      // unreachable or a store-stub; try the next candidate
    }
  }
  return ''
}

const reachablePython = findReachablePython()

describe('figure_svg_to_pptx sidecar structure (non-gated)', () => {
  it('keeps the argv contract and the additive stdout summary keys', () => {
    expect(source).toContain('usage: figure_svg_to_pptx.py <svg_path> <pptx_path> [title]')
    // v1 keys keep their names and semantics (fd-pptx node + tests rely on them).
    expect(source).toContain('"ok": True')
    expect(source).toContain('"shapes": shape_count')
    expect(source).toContain('"slidePx"')
    // v2 additive counters forwarded by the fd-pptx node on success.
    expect(source).toContain('"svgFeaturesMapped": features')
    expect(source).toContain('"svgFeaturesSkipped": skipped')
  })

  it('covers the v2 mapping vocabulary (paths, rotation, gradients, tspans)', () => {
    // path d-commands become freeform shapes (M/L/H/V/C/S/Q/T real, A approximated)
    expect(source).toContain('build_freeform')
    expect(source).toContain('sample_cubic')
    expect(source).toContain('sample_quadratic')
    expect(source).toContain('sample_arc')
    expect(source).toContain('"arcApproximated"')
    // rotate applies to bbox shapes via shape.rotation and orbits the center
    expect(source).toContain('shape.rotation')
    expect(source).toContain('rotation_degrees')
    // gradients resolve to one representative solid color, strokes preserved
    expect(source).toContain('collect_gradients')
    expect(source).toContain('resolve_paint')
    // tspans become runs (inline) or paragraphs (baseline shift)
    expect(source).toContain('tspan')
    expect(source).toContain('build_text_paragraphs')
  })

  it.runIf(reachablePython)('compiles as valid Python', () => {
    execFileSync(reachablePython, ['-m', 'py_compile', SIDE_CAR], { stdio: 'ignore', shell: false })
  })
})
