import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// figure-drawing end-to-end: the registered template runs through the REAL
// WorkflowManager scheduler. Only the agent/chat layer is mocked (canned SVG
// output); the deterministic script nodes (intake, render, pptx gate) execute
// as real `node -e` subprocesses. The scientific-figure-style skill binding is
// resolved by the REAL workflow skill resolver against a skill pack loaded
// through the research skillpack route — proving the loaded pack is consumed
// by the agent path, not just present on disk.
const originalE2eDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalE2eWebUiHome = process.env.HERMES_WEB_UI_HOME
const originalE2eStateDir = process.env.HERMES_WEBUI_STATE_DIR
const originalE2eHermesHome = process.env.HERMES_HOME
const originalPptxPython = process.env.RESEARCH_FIGURE_PPTX_PYTHON
const originalPptxSidecar = process.env.RESEARCH_FIGURE_PPTX_SIDECAR
const e2eTestRoot = mkdtempSync(join(tmpdir(), 'research-figure-drawing-e2e-'))
const hermesRoot = join(e2eTestRoot, 'hermes-root')
process.env.HERMES_WEB_UI_TEST_DB_DIR = join(e2eTestRoot, 'db')
process.env.HERMES_WEB_UI_HOME = join(e2eTestRoot, 'home')
process.env.HERMES_WEBUI_STATE_DIR = join(e2eTestRoot, 'home')
process.env.HERMES_HOME = hermesRoot
delete process.env.RESEARCH_FIGURE_PPTX_PYTHON
delete process.env.RESEARCH_FIGURE_PPTX_SIDECAR

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const chatRunMock = vi.hoisted(() => ({
  runAndWait: vi.fn(),
  abortSession: vi.fn(),
  sessionOutputs: new Map<string, string>(),
}))

const sessionStoreMock = vi.hoisted(() => ({
  createSession: vi.fn((data: { id: string }) => ({ id: data.id })),
}))

// Agent/chat runs are mocked; deterministic script dispatch forwards to the
// real deterministic executor so template script nodes execute as real
// `node -e` subprocesses exactly like in production. The workflow skill
// resolver is intentionally NOT mocked: it resolves the bound
// scientific-figure-style skill through the profile-config facade against the
// skill pack this test loads via the research skillpack route.
vi.mock('../../packages/server/src/modules/studio/public/workflow-runtime', async () => {
  const executor = await import('../../packages/server/src/modules/studio/services/workflow/deterministic-executor')
  return {
    isWorkflowRunCoordinatorAvailable: () => true,
    runWorkflowAndWait: (input: Record<string, unknown>, options: Record<string, unknown>) => chatRunMock.runAndWait(input, options),
    abortWorkflowSession: (sessionId: string, reason: string) => chatRunMock.abortSession(sessionId, reason),
    stopWorkflowAgentRun: vi.fn(),
    deleteWorkflowPrimaryAgentSession: vi.fn(async () => true),
    getWorkflowAvailableModelGroups: vi.fn(async () => []),
    runWorkflowDeterministicNode: (request: Record<string, unknown>) =>
      executor.executeWorkflowDeterministicNode(request as Parameters<typeof executor.executeWorkflowDeterministicNode>[0]),
  }
})

vi.mock('../../packages/server/src/modules/studio/services/agent-availability', () => ({
  assertAgentAvailable: vi.fn(),
}))

vi.mock('../../packages/server/src/modules/studio/repositories/session-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/server/src/modules/studio/repositories/session-store')>()
  return {
    ...actual,
    createSession: sessionStoreMock.createSession,
    getSession: vi.fn(() => null),
    getSessionDetail: vi.fn((sessionId: string) => ({
      messages: [{ role: 'assistant', content: chatRunMock.sessionOutputs.get(sessionId) || `output:${sessionId}` }],
    })),
    deleteSession: vi.fn(),
  }
})

// Canned agent output: a bar chart for labels [Control, Low, High] with data
// [10, 35, 80]. Bar heights map the data linearly at exactly 4.75 px per unit
// onto the 480px baseline, so the test can verify data fidelity of the whole
// agent → render pipeline.
const CANNED_BAR_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">',
  '  <rect x="0" y="0" width="900" height="560" fill="#ffffff"/>',
  '  <text x="450" y="40" font-size="22" text-anchor="middle" fill="#1f2430">Dose-Response</text>',
  '  <line x1="90" y1="480" x2="850" y2="480" stroke="#1f2430" stroke-width="1.5"/>',
  '  <line x1="90" y1="480" x2="90" y2="80" stroke="#1f2430" stroke-width="1.5"/>',
  '  <rect x="180" y="432.5" width="120" height="47.5" fill="#0072B2"/>',
  '  <rect x="420" y="313.75" width="120" height="166.25" fill="#0072B2"/>',
  '  <rect x="660" y="100" width="120" height="380" fill="#0072B2"/>',
  '  <text x="240" y="425" font-size="14" text-anchor="middle" fill="#1f2430">10.0</text>',
  '  <text x="480" y="306" font-size="14" text-anchor="middle" fill="#1f2430">35.0</text>',
  '  <text x="720" y="92" font-size="14" text-anchor="middle" fill="#1f2430">80.0</text>',
  '  <text x="240" y="505" font-size="16" text-anchor="middle" fill="#6b7280">Control</text>',
  '  <text x="480" y="505" font-size="16" text-anchor="middle" fill="#6b7280">Low</text>',
  '  <text x="720" y="505" font-size="16" text-anchor="middle" fill="#6b7280">High</text>',
  '  <text x="20" y="60" font-size="16" fill="#6b7280">Response (a.u.)</text>',
  '</svg>',
].join('\n')

const FIGURE_AGENT_SVG_OUTPUT = '```svg\n' + CANNED_BAR_SVG + '\n```'

const BRIEF = {
  title: 'Dose-Response',
  figureType: 'bar',
  outDir: join(e2eTestRoot, 'figure-run'),
  labels: ['Control', 'Low', 'High'],
  data: [10, 35, 80],
  xLabel: 'Dose (mg)',
  yLabel: 'Response (a.u.)',
}

function parseNodeOutput(row: { output_json: string }): Record<string, unknown> {
  return JSON.parse(row.output_json) as Record<string, unknown>
}

function nodeRow(result: { nodeSessions: Array<{ node_id: string }> }, nodeId: string): { node_id: string; session_id: string; status: string; output_json: string; error: string | null } {
  const row = result.nodeSessions.filter(session => session.node_id === nodeId).at(-1)
  expect(row, `node ${nodeId} must have a run session row`).toBeTruthy()
  return row as never
}

async function importE2eModules() {
  return {
    manager: await import('../../packages/server/src/modules/studio/services/workflow/manager'),
    workflowStore: await import('../../packages/server/src/modules/studio/repositories/workflow-store'),
  }
}

let routes: typeof import('../../packages/server/src/modules/research/skillpacks/index')

async function loadNatureResearchPack(): Promise<void> {
  // Load through the HTTP route so the full research surface is exercised.
  const dispatchRoute = routes.skillpacksRoutes.routes()
  const ctx: any = {
    method: 'POST',
    path: '/api/studio/research/skillpacks/nature-research/load',
    query: {},
    params: { id: 'nature-research' },
    request: { body: {} },
    state: {},
    status: 200,
    body: undefined,
  }
  await dispatchRoute(ctx, async () => {})
  expect(ctx.status).toBe(200)
  expect(ctx.body.pack.loaded).toBe(true)
}

beforeAll(async () => {
  const { configureProfileConfig } = await import('../../packages/server/src/modules/studio/public/profile-config')
  configureProfileConfig({
    buildModelGroups: () => ({ default: '', groups: [] }),
    getProfileDir: (profile: string) => {
      const root = process.env.HERMES_HOME || hermesRoot
      if (!profile || profile === 'default') return root
      const named = join(root, 'profiles', profile)
      return existsSync(named) ? named : root
    },
    getActiveProfileName: () => 'default',
    listProfileNames: () => ['default'],
    providerEnvironmentMap: {},
    readConfigYaml: async () => ({}),
    readConfigYamlForProfile: async () => ({}),
    safeReadFile: async (filePath: string) => {
      try { return readFileSync(filePath, 'utf-8') } catch { return null }
    },
    saveEnvValue: async () => {},
    saveEnvValueForProfile: async () => {},
    updateConfigYaml: async (updater: (config: Record<string, any>) => unknown) => updater({}),
    updateConfigYamlForProfile: async (_profile: string, updater: (config: Record<string, any>) => unknown) => updater({}),
  })
  const { initAllStores } = await import('../../packages/server/src/modules/studio/infrastructure/database/init')
  initAllStores()
  routes = await import('../../packages/server/src/modules/research/skillpacks/index')
})

beforeEach(() => {
  chatRunMock.runAndWait.mockReset()
  chatRunMock.abortSession.mockReset()
  chatRunMock.sessionOutputs.clear()
  sessionStoreMock.createSession.mockClear()
  chatRunMock.runAndWait.mockImplementation(async (input: { session_id: string; input: string }) => {
    const message = String(input.input)
    let output: string
    if (message.includes('科研绘图助手')) output = FIGURE_AGENT_SVG_OUTPUT
    else throw new Error(`unexpected agent node input: ${message.slice(0, 160)}`)
    chatRunMock.sessionOutputs.set(input.session_id, output)
    return { ok: true, output }
  })
})

afterAll(async () => {
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
  closeDb()
  restoreEnvironmentVariable('HERMES_WEB_UI_TEST_DB_DIR', originalE2eDbDir)
  restoreEnvironmentVariable('HERMES_WEB_UI_HOME', originalE2eWebUiHome)
  restoreEnvironmentVariable('HERMES_WEBUI_STATE_DIR', originalE2eStateDir)
  restoreEnvironmentVariable('HERMES_HOME', originalE2eHermesHome)
  restoreEnvironmentVariable('RESEARCH_FIGURE_PPTX_PYTHON', originalPptxPython)
  restoreEnvironmentVariable('RESEARCH_FIGURE_PPTX_SIDECAR', originalPptxSidecar)
  rmSync(e2eTestRoot, { recursive: true, force: true })
})

async function runFigureWorkflow(brief: Record<string, unknown>, name: string) {
  const { manager, workflowStore } = await importE2eModules()
  const { getResearchWorkflowTemplate } = await import('../../packages/server/src/modules/research/workflows/template-service')
  const template = getResearchWorkflowTemplate('figure-drawing')!
  const nodes = template.nodes.map(node => node.id === 'fd-intake'
    ? { ...node, data: { ...node.data, input: JSON.stringify(brief) } }
    : node)
  const workflow = workflowStore.createWorkflow({
    name,
    profile: template.profile,
    nodes,
    edges: template.edges,
  })
  const instance = new manager.WorkflowManager()
  return instance.runNow(workflow.id)
}

describe('figure-drawing end-to-end run (real engine, real deterministic render)', () => {
  it('refuses to run while the bound scientific-figure-style skill is not loaded', async () => {
    const { manager, workflowStore } = await importE2eModules()
    const { getResearchWorkflowTemplate } = await import('../../packages/server/src/modules/research/workflows/template-service')
    const template = getResearchWorkflowTemplate('figure-drawing')!
    const workflow = workflowStore.createWorkflow({
      name: 'figure without skill pack',
      profile: template.profile,
      nodes: template.nodes,
      edges: template.edges,
    })
    // The engine preflight enforces skill availability: this is the mechanism
    // that makes "skill 被工作流 Agent 调用" a hard, checkable contract.
    await expect(new manager.WorkflowManager().runNow(workflow.id))
      .rejects.toThrow(/requires unavailable skill: scientific-figure-style/)
  })

  it('runs intake → agent (skill-bound) → render to figure.svg and degrades the pptx stage gracefully', async () => {
    await loadNatureResearchPack()
    const result = await runFigureWorkflow(BRIEF, 'figure drawing e2e')
    expect(result.run.status).toBe('completed')
    expect(result.run.error).toBeNull()
    for (const nodeId of ['fd-intake', 'fd-figure-agent', 'fd-render', 'fd-pptx']) {
      expect(nodeRow(result, nodeId).status, nodeId).toBe('completed')
    }

    // The agent node ran through the chat layer as a real session, with the
    // loaded skill content injected by the engine's skill binding.
    expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(1)
    const agentMessage = String(chatRunMock.runAndWait.mock.calls[0][0].input)
    expect(agentMessage).toContain('[Workflow selected skills]')
    expect(agentMessage).toContain('[Skill: scientific-figure-style]')
    expect(agentMessage).toContain('绘制→检查→修正')
    expect(agentMessage).toContain('[Upstream: 绘图需求接入]')
    expect(agentMessage).toContain('"figureType":"bar"')
    const agentRow = nodeRow(result, 'fd-figure-agent')
    expect(agentRow.session_id).not.toBe('')

    // Intake normalized the brief through a real subprocess.
    const intake = parseNodeOutput(nodeRow(result, 'fd-intake'))
    expect(intake).toMatchObject({
      title: 'Dose-Response',
      figureType: 'bar',
      outDir: BRIEF.outDir,
      labelCount: 3,
      dataCount: 3,
    })

    // Render executed for real: figure.svg on disk with the full SVG content,
    // and no engine packaging lines leaked into the artifact.
    const render = parseNodeOutput(nodeRow(result, 'fd-render'))
    expect(render.format).toBe('svg')
    expect(render.svgPath).toBe(join(BRIEF.outDir, 'figure.svg'))
    expect(Number(render.bytes)).toBeGreaterThan(500)
    expect(Number(render.width)).toBe(900)
    expect(Number(render.height)).toBe(560)
    const svgDocument = readFileSync(String(render.svgPath), 'utf8')
    expect(svgDocument.startsWith('<svg')).toBe(true)
    expect(svgDocument.trim().endsWith('</svg>')).toBe(true)
    expect(svgDocument).toContain('#0072B2')
    expect(svgDocument).toContain('Response (a.u.)')
    // Data fidelity: bar heights must stay proportional to the brief data.
    const heights = [...svgDocument.matchAll(/<rect x="\d+" y="[\d.]+" width="\d+" height="([\d.]+)" fill="#0072B2"/g)].map(match => Number(match[1]))
    expect(heights).toEqual([47.5, 166.25, 380])
    expect(svgDocument).not.toContain('[Workflow upstream results]')
    expect(svgDocument).not.toContain('[Upstream:')
    expect(svgDocument).not.toContain('[Current task]')
    expect(svgDocument).not.toContain('Execute the current workflow node.')

    // The pptx stage is an optional gate: without RESEARCH_FIGURE_PPTX_PYTHON
    // it reports the degradation reason and the run still completes.
    const pptx = parseNodeOutput(nodeRow(result, 'fd-pptx'))
    expect(pptx.pptxExported).toBe(false)
    expect(String(pptx.reason)).toContain('RESEARCH_FIGURE_PPTX_PYTHON')
    expect(String(pptx.svgPath)).toBe(join(BRIEF.outDir, 'figure.svg'))
    expect(existsSync(join(BRIEF.outDir, 'figure.pptx'))).toBe(false)
  }, 60000)

  it('fails deterministically on an invalid brief before any agent run', async () => {
    const result = await runFigureWorkflow({ title: 'No output dir', figureType: 'bar' }, 'figure bad brief')
    expect(result.run.status).toBe('failed')
    expect(String(result.run.error)).toContain('outDir')
    expect(nodeRow(result, 'fd-intake').status).toBe('failed')
    expect(chatRunMock.runAndWait).not.toHaveBeenCalled()
  }, 60000)

  it('fails the render node when the agent output contains no SVG document', async () => {
    chatRunMock.runAndWait.mockImplementation(async (input: { session_id: string; input: string }) => {
      const message = String(input.input)
      if (!message.includes('科研绘图助手')) throw new Error(`unexpected agent node input: ${message.slice(0, 120)}`)
      const output = '这张示意图需要先补充数据来源，本轮无法输出图形。'
      chatRunMock.sessionOutputs.set(input.session_id, output)
      return { ok: true, output }
    })
    // A dedicated outDir keeps this negative case independent of artifacts
    // left behind by the successful run above.
    const garbageOutDir = join(e2eTestRoot, 'figure-run-garbage')
    const result = await runFigureWorkflow({ ...BRIEF, outDir: garbageOutDir }, 'figure garbage agent')
    expect(result.run.status).toBe('failed')
    const render = nodeRow(result, 'fd-render')
    expect(render.status).toBe('failed')
    expect(String(render.error)).toContain('could not find an SVG document')
    expect(existsSync(join(garbageOutDir, 'figure.svg'))).toBe(false)
  }, 60000)
})

// Gated real-pptx smoke: needs HERMES_FIGURE_PPTX_SMOKE=1 plus a Python
// interpreter with python-pptx in RESEARCH_FIGURE_PPTX_PYTHON (see
// docs/research-workbench/T4.4-figure-pptx-spike.md). Skipped otherwise so CI
// stays hermetic without Python.
function pythonHasPptx(bin: string): boolean {
  try {
    execFileSync(bin, ['-c', 'import pptx'], { stdio: 'ignore', shell: false })
    return true
  } catch {
    return false
  }
}
// The interpreter to gate on is the one configured OUTSIDE the test process:
// the top-level isolation code deletes the in-process value so the main run
// exercises the graceful-degradation path.
const gatedPptxPython = originalPptxPython || ''
const realPptxReady = process.env.HERMES_FIGURE_PPTX_SMOKE === '1'
  && gatedPptxPython !== ''
  && pythonHasPptx(gatedPptxPython)

const SIDE_CAR = join(__dirname, '../../packages/server/src/modules/research/workflows/scripts/figure_svg_to_pptx.py')

describe.skipIf(!realPptxReady)('figure-drawing gated real pptx export (python-pptx sidecar)', () => {
  it('exports the rendered figure into a real .pptx with editable shapes', async () => {
    // Self-contained: loading the pack here keeps the gate meaningful even
    // when only this describe runs (-t).
    await loadNatureResearchPack()
    process.env.RESEARCH_FIGURE_PPTX_PYTHON = gatedPptxPython
    process.env.RESEARCH_FIGURE_PPTX_SIDECAR = SIDE_CAR
    const outDir = join(e2eTestRoot, 'figure-run-pptx')
    const result = await runFigureWorkflow({ ...BRIEF, outDir }, 'figure pptx gated')
    expect(result.run.status).toBe('completed')
    expect(nodeRow(result, 'fd-render').status).toBe('completed')

    const pptx = parseNodeOutput(nodeRow(result, 'fd-pptx'))
    expect(pptx.pptxExported, JSON.stringify(pptx)).toBe(true)
    const pptxPath = String(pptx.pptxPath)
    expect(pptxPath).toBe(join(outDir, 'figure.pptx'))
    expect(Number(pptx.bytes)).toBeGreaterThan(10_000)
    expect(existsSync(pptxPath)).toBe(true)
    expect(readFileSync(pptxPath).subarray(0, 2).toString('latin1')).toBe('PK')

    // Round-trip through python-pptx: the figure must exist as native,
    // countable shapes on a slide sized like the SVG canvas.
    const probe = execFileSync(gatedPptxPython, ['-c', [
      'from pptx import Presentation',
      'from pptx.util import Emu',
      `p = Presentation(r"${pptxPath}")`,
      's = p.slides[0]',
      'print(len(s.shapes))',
      'print(int(round(p.slide_width / 9525)))',
      'print(int(round(p.slide_height / 9525)))',
    ].join('; ')], { encoding: 'utf8', shell: false })
    const [shapeCount, widthPx, heightPx] = probe.trim().split('\n').map(line => Number(line))
    expect(shapeCount).toBeGreaterThanOrEqual(10)
    expect(widthPx).toBe(900)
    expect(heightPx).toBe(560)
  }, 90000)
})
