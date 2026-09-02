import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalTemplateTestDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalTemplateTestWebUiHome = process.env.HERMES_WEB_UI_HOME
const originalTemplateTestStateDir = process.env.HERMES_WEBUI_STATE_DIR
const templateTestRoot = mkdtempSync(join(tmpdir(), 'research-workflow-templates-'))
const templateTestDbDir = join(templateTestRoot, 'db')
const templateTestHome = join(templateTestRoot, 'home')
process.env.HERMES_WEB_UI_TEST_DB_DIR = templateTestDbDir
process.env.HERMES_WEB_UI_HOME = templateTestHome
process.env.HERMES_WEBUI_STATE_DIR = templateTestHome

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

// Mocks below only satisfy the Studio workflow manager import used by the
// normalize-compatibility suite; the template registry itself has no Studio
// dependencies.
const sessionStoreMock = vi.hoisted(() => ({
  createSession: vi.fn((data: { id: string }) => ({ id: data.id })),
}))

vi.mock('../../packages/server/src/modules/studio/services/workflow/skill-resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/server/src/modules/studio/services/workflow/skill-resolver')>()
  return {
    ...actual,
    resolveWorkflowSkillContent: () => Promise.resolve(null),
  }
})

vi.mock('../../packages/server/src/modules/studio/public/workflow-runtime', () => ({
  isWorkflowRunCoordinatorAvailable: () => true,
  runWorkflowAndWait: vi.fn(),
  abortWorkflowSession: vi.fn(),
  stopWorkflowAgentRun: vi.fn(),
  deleteWorkflowPrimaryAgentSession: vi.fn(async () => true),
  getWorkflowAvailableModelGroups: vi.fn(async () => []),
  runWorkflowDeterministicNode: vi.fn(),
}))

vi.mock('../../packages/server/src/modules/studio/services/agent-availability', () => ({
  assertAgentAvailable: vi.fn(),
}))

vi.mock('../../packages/server/src/modules/studio/repositories/session-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/server/src/modules/studio/repositories/session-store')>()
  return {
    ...actual,
    createSession: sessionStoreMock.createSession,
    getSession: vi.fn(() => null),
    getSessionDetail: vi.fn((sessionId: string) => ({ messages: [], sessionId })),
    deleteSession: vi.fn(),
  }
})

import {
  validateTemplateDefinition,
  WORKFLOW_TEMPLATE_SCRIPT_DATA_KEYS,
  WORKFLOW_TEMPLATE_SCRIPT_RUNTIME,
  type ResearchWorkflowTemplate,
} from '../../packages/server/src/modules/research/workflows/template-contract'
import { getResearchWorkflowTemplate } from '../../packages/server/src/modules/research/workflows/template-service'
import { WORKFLOW_SCRIPT_NODE_RUNTIME } from '../../packages/client/src/utils/workflow-node-type'

const ROUTES_MODULE = '../../packages/server/src/modules/research/workflows/index'

type WorkflowsRoutesModule = typeof import('../../packages/server/src/modules/research/workflows/index')

let routes: WorkflowsRoutesModule

async function importWorkflowsRoutes(): Promise<WorkflowsRoutesModule> {
  return import(ROUTES_MODULE)
}

async function importStudioWorkflowManager() {
  return import('../../packages/server/src/modules/studio/services/workflow/manager')
}

// Dispatch through the real router middleware so path params and method
// matching behave like an incoming request.
async function dispatch(method: string, path: string, overrides: Record<string, unknown> = {}) {
  const dispatchRoute = routes.workflowsRoutes.routes()
  const ctx: any = {
    method,
    path,
    query: {},
    params: {},
    request: { body: undefined },
    state: {},
    status: 200,
    body: undefined,
    ...overrides,
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

function registeredTemplates(): ResearchWorkflowTemplate[] {
  // Fetched through the public get surface to keep the registry the
  // single source of truth for these assertions.
  return ['literature-review', 'paper-translate', 'overnight-research', 'figure-drawing'].map(id => {
    const template = getResearchWorkflowTemplate(id)
    expect(template, `template ${id} must be registered`).toBeTruthy()
    return template as ResearchWorkflowTemplate
  })
}

beforeAll(async () => {
  const { initAllStores } = await import('../../packages/server/src/modules/studio/infrastructure/database/init')
  initAllStores()
  routes = await importWorkflowsRoutes()
})

afterAll(async () => {
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
  closeDb()
  restoreEnvironmentVariable('HERMES_WEB_UI_TEST_DB_DIR', originalTemplateTestDbDir)
  restoreEnvironmentVariable('HERMES_WEB_UI_HOME', originalTemplateTestWebUiHome)
  restoreEnvironmentVariable('HERMES_WEBUI_STATE_DIR', originalTemplateTestStateDir)
  rmSync(templateTestRoot, { recursive: true, force: true })
})

describe('research workflow template registry (HTTP)', () => {
  it('keeps the health route working next to the template routes', async () => {
    const ctx = await dispatch('GET', '/api/studio/research/workflows/health')
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ ok: true, subdomain: 'workflows' })
  })

  it('lists all registered templates as summaries without leaking node payloads', async () => {
    const ctx = await dispatch('GET', '/api/studio/research/workflows/templates')
    expect(ctx.status).toBe(200)
    expect(ctx.body.templates.map((template: any) => template.id)).toEqual(['literature-review', 'paper-translate', 'overnight-research', 'figure-drawing'])
    for (const template of ctx.body.templates) {
      expect(template.nodeCount).toBeGreaterThan(0)
      // Linear templates use exactly nodeCount-1 edges; the overnight-research
      // diamond adds one join edge on top of its spanning tree.
      expect(template.edgeCount).toBeGreaterThanOrEqual(template.nodeCount - 1)
      expect(Object.keys(template)).not.toContain('nodes')
      expect(Object.keys(template)).not.toContain('edges')
    }
    const paperTranslate = ctx.body.templates.find((template: any) => template.id === 'paper-translate')
    expect(paperTranslate.requiredEnv).toHaveProperty('OPENAI_API_KEY')
  })

  it('returns the full template through GET /templates/:id and 404 for unknown ids', async () => {
    const ctx = await dispatch('GET', '/api/studio/research/workflows/templates/literature-review')
    expect(ctx.status).toBe(200)
    expect(ctx.body.template).toMatchObject({ id: 'literature-review', name: '文献综述', profile: 'default' })
    expect(ctx.body.template.nodes).toHaveLength(6)
    expect(ctx.body.template.edges).toHaveLength(5)

    const overnight = await dispatch('GET', '/api/studio/research/workflows/templates/overnight-research')
    expect(overnight.status).toBe(200)
    expect(overnight.body.template).toMatchObject({ id: 'overnight-research', name: '过夜自主科研', profile: 'default' })
    expect(overnight.body.template.nodes).toHaveLength(5)
    expect(overnight.body.template.edges).toHaveLength(6)

    const missing = await dispatch('GET', '/api/studio/research/workflows/templates/does-not-exist')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'workflow template not found' })
  })

  it('validates a registered template through POST /templates/:id/validate', async () => {
    const ctx = await dispatch('POST', '/api/studio/research/workflows/templates/paper-translate/validate')
    expect(ctx.status).toBe(200)
    expect(ctx.body).toMatchObject({
      template: { id: 'paper-translate', name: '论文翻译' },
      valid: true,
      problems: [],
      checked: { nodes: 4, edges: 3 },
    })

    const overnight = await dispatch('POST', '/api/studio/research/workflows/templates/overnight-research/validate')
    expect(overnight.status).toBe(200)
    expect(overnight.body).toMatchObject({
      template: { id: 'overnight-research', name: '过夜自主科研' },
      valid: true,
      problems: [],
      checked: { nodes: 5, edges: 6 },
    })

    const missing = await dispatch('POST', '/api/studio/research/workflows/templates/does-not-exist/validate')
    expect(missing.status).toBe(404)
  })
})

describe('research workflow template schema', () => {
  it('passes the research template contract with zero problems', () => {
    for (const template of registeredTemplates()) {
      expect(validateTemplateDefinition(template)).toEqual([])
    }
  })

  it('uses only the engine node palette and linear pipeline stages', () => {
    const templates = registeredTemplates()
    expect(templates.find(template => template.id === 'literature-review')!.steps)
      .toEqual(['文献检索', '文献筛选', '精读', '综述初稿', '引用核查', 'HTML 报告'])
    expect(templates.find(template => template.id === 'paper-translate')!.steps)
      .toEqual(['PDF 接入校验', 'pdf2zh 翻译', '双语对照', '术语表沉淀'])
    expect(templates.find(template => template.id === 'overnight-research')!.steps)
      .toEqual(['队列接入', '批处理执行', '逐批聚合', '下一步建议', '晨报报告'])
    expect(templates.find(template => template.id === 'figure-drawing')!.steps)
      .toEqual(['绘图需求接入', 'SVG 绘图生成', '确定性渲染', 'pptx 导出（可选）'])

    for (const template of templates) {
      expect(template.steps).toEqual(template.nodes.map(node => node.data.title))
      for (const node of template.nodes) {
        expect(['agent', 'script', 'validate', 'render']).toContain(node.type)
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      }
    }
  })

  it('wires overnight-research as a diamond join plus a suggestion agent so the report sees ledger and suggestions', () => {
    const template = registeredTemplates().find(candidate => candidate.id === 'overnight-research')!
    const nodeIds = template.nodes.map(node => node.id)
    expect(nodeIds).toEqual(['or-queue-intake', 'or-batch-executor', 'or-batch-aggregate', 'or-next-steps', 'or-morning-report'])

    // Exactly one entry node (the queue intake script) and one sink (the
    // morning report script); the aggregation node joins two upstream edges,
    // the next-steps agent sits between the join and the report, and the
    // second diamond edge (aggregate -> report) hands the audited ledger to
    // the report without passing it through the suggestion agent.
    const incoming = new Map<string, string[]>()
    for (const edge of template.edges) {
      incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source])
    }
    expect(nodeIds.filter(id => !incoming.has(id))).toEqual(['or-queue-intake'])
    expect(nodeIds.filter(id => !(template.edges.some(edge => edge.source === id)))).toEqual(['or-morning-report'])
    expect(incoming.get('or-batch-aggregate')!.sort()).toEqual(['or-batch-executor', 'or-queue-intake'])
    expect(incoming.get('or-batch-executor')).toEqual(['or-queue-intake'])
    expect(incoming.get('or-next-steps')).toEqual(['or-batch-aggregate'])
    expect(incoming.get('or-morning-report')!.sort()).toEqual(['or-batch-aggregate', 'or-next-steps'])

    // Only batch execution and next-step suggestion are agent nodes; the queue,
    // the join, and the report stay deterministic.
    expect(template.nodes.filter(node => node.type === 'agent').map(node => node.id)).toEqual(['or-batch-executor', 'or-next-steps'])
    const aggregate = template.nodes.find(node => node.id === 'or-batch-aggregate')!
    expect(aggregate.data.orchestration.join).toBe('all')
    // The executor prompt demands machine-checkable per-item JSON lines so the
    // aggregation stays deterministic regardless of the configured runtime.
    const executor = template.nodes.find(node => node.id === 'or-batch-executor')!
    expect(executor.data.input).toContain('"status": "success" 或 "failed"')
    expect(executor.data.input).toContain('必须覆盖计划中的每一个 id')
    // The suggestions prompt demands machine-parseable one-JSON-line-per-
    // suggestion output covering remediation, low completion rate, and
    // parallelizable/automatable follow-ups.
    const nextSteps = template.nodes.find(node => node.id === 'or-next-steps')!
    expect(nextSteps.data.input).toContain('{"suggestion":')
    expect(nextSteps.data.input).toContain('3-5 条可执行的下一步建议')
    expect(nextSteps.data.input).toContain('失败项与缺失项的补救')
    expect(nextSteps.data.input).toContain('完成率偏低时的处理')
    expect(nextSteps.data.input).toContain('可并行或可自动化的后续动作')
    // The morning report must consume the ledger and degrade gracefully.
    const report = template.nodes.find(node => node.id === 'or-morning-report')!
    expect(report.data.code).toContain('parseSuggestionLine')
    expect(report.data.code).toContain('自动建议生成失败')
  })

  it('reports every problem in a broken template definition', () => {
    const agentNode = {
      id: 'a1', type: 'agent', position: { x: 0, y: 0 },
      data: { title: 'A', input: '', orchestration: { join: 'all' }, agent: 'hermes', agentMode: 'scoped', provider: 'only-provider' },
    }
    const scriptNode = {
      id: 's1', type: 'script', position: { x: 320, y: 0 },
      data: { title: 'S', input: '', orchestration: { join: 'all' }, runtime: 'python', code: '', junk: true },
    }
    const problems = validateTemplateDefinition({
      id: 'Broken_Template', name: '', description: '', profile: 'default', steps: [],
      nodes: [
        agentNode,
        scriptNode,
        { id: 'a1', type: 'shell', position: { x: 0, y: 0 }, data: {} },
        { id: 'island', type: 'render', position: { x: 640, y: 0 }, data: { title: 'Island', input: '', orchestration: { join: 'all' } } },
        { id: 'island2', type: 'validate', position: { x: 960, y: 0 }, data: { title: 'Island 2', input: '', orchestration: { join: 'all' } } },
      ],
      edges: [
        { id: 'e1', source: 'ghost', target: 's1', orchestration: { route: 'success' } },
        { id: 'e1', source: 'a1', target: 's1', orchestration: { route: 'sometimes' } },
        // A detached two-node cycle: keeps the single entry a1 while making
        // the island subgraph unreachable from it.
        { id: 'e3', source: 'island', target: 'island2', orchestration: { route: 'success' } },
        { id: 'e4', source: 'island2', target: 'island', orchestration: { route: 'success' } },
      ],
    })

    expect(problems).toContain('workflow template Broken_Template: id must be a kebab-case slug of 2-64 characters')
    expect(problems).toContain('workflow template Broken_Template: name must be a non-empty string')
    expect(problems).toContain('workflow template Broken_Template: steps must be a non-empty array of strings')
    expect(problems).toContain('workflow template Broken_Template: node a1 is duplicated')
    expect(problems).toContain('workflow template Broken_Template: node a1 target must set provider, model, and apiMode together')
    expect(problems).toContain('workflow template Broken_Template: node s1 data keys must be exactly title, input, orchestration, runtime, code')
    expect(problems).toContain('workflow template Broken_Template: node s1 data.runtime must be "node"')
    expect(problems).toContain('workflow template Broken_Template: node s1 data.code must be a non-empty script')
    expect(problems.some(problem => problem.includes('unsupported type: shell'))).toBe(true)
    expect(problems).toContain('workflow template Broken_Template: edge e1 references unknown source node: ghost')
    expect(problems).toContain('workflow template Broken_Template: edge e1 orchestration.route must be one of: success, failure, always')
    expect(problems).toContain('workflow template Broken_Template: node island is not reachable from the entry node')

    // Dropping the first edge of a linear template leaves two roots.
    const literatureReview = getResearchWorkflowTemplate('literature-review')!
    const twoRoots = validateTemplateDefinition({
      ...literatureReview,
      edges: literatureReview.edges.slice(1),
    })
    expect(twoRoots).toContain('workflow template literature-review: template must have exactly one entry node (no incoming edge), found: 2')
  })
})

describe('base engine normalize compatibility', () => {
  it('round-trips every template node through normalizeWorkflowNode unchanged', async () => {
    const { normalizeWorkflowNode } = await importStudioWorkflowManager()

    for (const template of registeredTemplates()) {
      for (const node of template.nodes) {
        expect(normalizeWorkflowNode(node), `node ${template.id}/${node.id} must survive engine normalization`)
          .toEqual(node)
      }
    }
  })

  it('round-trips every template edge through normalizeWorkflowEdge unchanged', async () => {
    const { normalizeWorkflowEdge } = await importStudioWorkflowManager()

    for (const template of registeredTemplates()) {
      for (const edge of template.edges) {
        expect(normalizeWorkflowEdge(edge), `edge ${template.id}/${edge.id} must survive engine normalization`)
          .toEqual(edge)
      }
    }
  })

  it('agrees with the client node factory on the script runtime constant', () => {
    expect(WORKFLOW_TEMPLATE_SCRIPT_RUNTIME).toBe(WORKFLOW_SCRIPT_NODE_RUNTIME)
    expect(WORKFLOW_TEMPLATE_SCRIPT_DATA_KEYS).toEqual(['title', 'input', 'orchestration', 'runtime', 'code'])
  })
})

describe('template script node data contract', () => {
  it('carries exactly the 5-key data contract with non-empty runnable code', () => {
    for (const template of registeredTemplates()) {
      const scriptNodes = template.nodes.filter(node => node.type === 'script')
      expect(scriptNodes.length, `template ${template.id} must use deterministic script nodes`).toBeGreaterThan(0)
      for (const node of scriptNodes) {
        expect(Object.keys(node.data).sort()).toEqual([...WORKFLOW_TEMPLATE_SCRIPT_DATA_KEYS].sort())
        expect(node.data.runtime).toBe(WORKFLOW_SCRIPT_NODE_RUNTIME)
        expect(typeof node.data.code).toBe('string')
        expect(node.data.code!.trim()).not.toBe('')
        // Compile check: catches escaping bugs in the embedded script bodies
        // without executing them.
        expect(() => new Function(node.data.code!), `script of ${template.id}/${node.id} must be valid JavaScript`)
          .not.toThrow()
      }
    }
  })

  it('keeps every subprocess invocation on structured argv arrays without a shell', () => {
    for (const template of registeredTemplates()) {
      for (const node of template.nodes.filter(candidate => candidate.type === 'script')) {
        const code = node.data.code!
        const spawnCalls = code.match(/spawn\(/g) || []
        // spawn(binary, argv, options): argv must be an identifier or an
        // inline array — never a concatenated command string.
        const arrayArgvCalls = code.match(/spawn\(\s*[\w.]+\s*,\s*(\w+|\[)/g) || []
        expect(arrayArgvCalls.length).toBe(spawnCalls.length)
        expect(code).not.toContain('shell: true')
        expect(code).not.toMatch(/\bexecSync\s*\(/)
        expect(code).not.toMatch(/\bexec\s*\(/)
      }
    }
  })

  it('translates paper PDFs through the OpenAI-compatible API only', () => {
    const template = registeredTemplates().find(candidate => candidate.id === 'paper-translate')!
    const translate = template.nodes.find(node => node.id === 'pt-translate')!
    expect(translate.type).toBe('script')
    const code = translate.data.code!

    // API-first: pdf2zh runs with the openai service, no local model anywhere.
    expect(code).toContain("'-s', 'openai'")
    expect(code).toContain('process.env.OPENAI_API_KEY')
    expect(code).not.toMatch(/\b(torch|transformers|ollama|llama|whisper|nllb|argos|marian|opus-mt)\b/i)
    expect(code).toContain("'-lo', targetLang")

    // Credentials and endpoint reach pdf2zh through the environment, not argv.
    expect(code).toContain('OPENAI_BASE_URL')
    expect(code).toContain('OPENAI_MODEL')
    const argvLine = code.match(/var args = \[[^\]]*\]/)
    expect(argvLine).toBeTruthy()
    expect(argvLine![0]).not.toContain('apiKey')
    expect(argvLine![0]).not.toContain('KEY')
  })

  it('carries no credential material in node data — keys flow through the environment only', () => {
    for (const template of registeredTemplates()) {
      for (const node of template.nodes) {
        // The script SOURCE names the env vars it reads; what must never
        // appear is a data field carrying or asking for a credential value.
        for (const dataKey of Object.keys(node.data)) {
          expect(dataKey).not.toMatch(/api[-_]?key|secret|token|credential/i)
        }
      }
    }
    expect(registeredTemplates().find(candidate => candidate.id === 'paper-translate')!.requiredEnv)
      .toEqual({ OPENAI_API_KEY: expect.any(String) })
  })
})
