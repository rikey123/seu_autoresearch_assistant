import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// figure-drawing template structure: DAG shape, contract compliance, and the
// skill-pack binding that ties the template to the research skill loader.
// Engine round-trip of every node/edge is asserted centrally in
// research-workflow-templates.test.ts.
import { getResearchWorkflowTemplate } from '../../packages/server/src/modules/research/workflows/template-service'
import { validateTemplateDefinition } from '../../packages/server/src/modules/research/workflows/template-contract'
import { findMissingSkillAssets, getResearchSkillPack } from '../../packages/server/src/modules/research/skillpacks/skillpack-service'

const template = getResearchWorkflowTemplate('figure-drawing')!
const ASSETS_DIR = join(__dirname, '../../packages/server/src/modules/research/skillpacks/assets')

describe('figure-drawing template definition', () => {
  it('is a registered template that passes the research template contract', () => {
    expect(template).toBeTruthy()
    expect(validateTemplateDefinition(template)).toEqual([])
  })

  it('wires intake -> agent -> render -> pptx with the intake join into the render node', () => {
    expect(template!.nodes.map(node => node.id)).toEqual(['fd-intake', 'fd-figure-agent', 'fd-render', 'fd-pptx'])
    const incoming = new Map<string, string[]>()
    for (const edge of template!.edges) {
      incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source])
    }
    // Exactly one entry (the intake script) and one sink (the pptx export);
    // the render node joins the normalized brief with the agent's SVG.
    expect(template!.nodes.filter(node => !incoming.has(node.id)).map(node => node.id)).toEqual(['fd-intake'])
    expect(template!.nodes.filter(node => !template!.edges.some(edge => edge.source === node.id)).map(node => node.id)).toEqual(['fd-pptx'])
    expect(incoming.get('fd-figure-agent')).toEqual(['fd-intake'])
    expect([...(incoming.get('fd-render') || [])].sort()).toEqual(['fd-figure-agent', 'fd-intake'])
    expect(incoming.get('fd-pptx')).toEqual(['fd-render'])
  })

  it('keeps only the drawing step on the agent path and stays runnable without credentials', () => {
    const agentNodes = template!.nodes.filter(node => node.type === 'agent')
    expect(agentNodes.map(node => node.id)).toEqual(['fd-figure-agent'])
    expect(template!.requiredEnv).toBeUndefined()
    expect(Object.keys(template!.optionalEnv || {})).toEqual(
      expect.arrayContaining(['RESEARCH_FIGURE_PPTX_PYTHON', 'RESEARCH_FIGURE_PPTX_SIDECAR'])
    )
  })

  it('binds the scientific-figure-style skill from the research skill pack', () => {
    const agent = template!.nodes.find(node => node.id === 'fd-figure-agent')!
    expect(agent.data.skills).toEqual(['scientific-figure-style'])
    const pack = getResearchSkillPack('nature-research')!
    expect(findMissingSkillAssets(pack)).toEqual([])
    expect(pack.skills.map(skill => skill.name)).toContain('scientific-figure-style')
    // The bound skill pins the output convention the render node relies on.
    const skill = readFileSync(join(ASSETS_DIR, 'scientific-figure-style', 'SKILL.md'), 'utf8')
    expect(skill).toContain('svg')
    expect(skill).toContain('绘制→检查→修正')
  })

  it('keeps the agent output contract strict enough for deterministic rendering', () => {
    const agent = template!.nodes.find(node => node.id === 'fd-figure-agent')!
    expect(agent.data.input).toContain('仅有一个')
    expect(agent.data.input).toContain('svg')

    const intake = template!.nodes.find(node => node.id === 'fd-intake')!
    expect(intake.data.code).toContain('outDir must be an absolute path')
    expect(intake.data.code).toContain("allowedTypes.indexOf(figureType)")

    const render = template!.nodes.find(node => node.id === 'fd-render')!
    expect(render.data.code).toContain('figure.svg')
    expect(render.data.code).toContain('<script')
    expect(render.data.code).toContain('extractSvgDocument')

    const pptx = template!.nodes.find(node => node.id === 'fd-pptx')!
    expect(pptx.data.code).toContain('RESEARCH_FIGURE_PPTX_PYTHON')
    expect(pptx.data.code).toContain('pptxExported: false')
  })
})
