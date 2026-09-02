// Research-domain workflow template contract. Mirrors the Studio workflow
// engine's node/edge shapes (studio services workflow manager
// normalizeWorkflowNode / normalizeWorkflowEdge) without importing Studio
// internals: the module boundary rules only let research consume Studio
// contracts/public APIs. Round-trip compatibility with the real engine is
// asserted in tests/server/research-workflow-templates.test.ts.

export const WORKFLOW_TEMPLATE_NODE_TYPES = ['agent', 'script', 'validate', 'render'] as const
export type WorkflowTemplateNodeType = (typeof WORKFLOW_TEMPLATE_NODE_TYPES)[number]

/** Mirrors WORKFLOW_SCRIPT_NODE_RUNTIME in packages/client/src/utils/workflow-node-type.ts. */
export const WORKFLOW_TEMPLATE_SCRIPT_RUNTIME = 'node' as const

/** Exact script-node data contract: {title, input, orchestration, runtime, code}. */
export const WORKFLOW_TEMPLATE_SCRIPT_DATA_KEYS = ['title', 'input', 'orchestration', 'runtime', 'code'] as const
export const WORKFLOW_TEMPLATE_DETERMINISTIC_DATA_KEYS = ['title', 'input', 'orchestration'] as const

const WORKFLOW_TEMPLATE_AGENTS = ['hermes', 'ekko-agent', 'claude-code', 'codex', 'pi'] as const
const WORKFLOW_TEMPLATE_GLOBAL_MODE_AGENTS = new Set(['claude-code', 'codex', 'pi'])
const WORKFLOW_TEMPLATE_API_MODES = ['chat_completions', 'codex_responses', 'anthropic_messages'] as const
const WORKFLOW_TEMPLATE_REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const WORKFLOW_TEMPLATE_EDGE_ROUTES = ['success', 'failure', 'always'] as const

export interface WorkflowTemplateNodeData {
  title: string
  input: string
  orchestration: { join: 'all' | 'any' }
  // Script-node payload (exact key set enforced by the validator).
  runtime?: typeof WORKFLOW_TEMPLATE_SCRIPT_RUNTIME
  code?: string
  // Agent-node payload; the validator rejects anything outside this set.
  agent?: string
  agentMode?: 'scoped' | 'global'
  provider?: string
  model?: string
  apiMode?: string
  reasoningEffort?: string
  skills?: string[]
  images?: string[]
  approvalRequired?: boolean
}

export interface WorkflowTemplateNode {
  id: string
  type: WorkflowTemplateNodeType
  position: { x: number; y: number }
  data: WorkflowTemplateNodeData
}

export interface WorkflowTemplateEdge {
  id: string
  source: string
  target: string
  orchestration: { route: 'success' | 'failure' | 'always' }
}

export interface ResearchWorkflowTemplate {
  id: string
  name: string
  description: string
  profile: string
  /** Ordered human-readable pipeline stages, 1:1 with the node titles. */
  steps: string[]
  /** Environment variables the template refuses to run without. */
  requiredEnv?: Record<string, string>
  /** Environment variables that tune behavior but have defaults. */
  optionalEnv?: Record<string, string>
  nodes: WorkflowTemplateNode[]
  edges: WorkflowTemplateEdge[]
}

export interface ResearchWorkflowTemplateSummary {
  id: string
  name: string
  description: string
  profile: string
  steps: string[]
  nodeCount: number
  edgeCount: number
  nodeTypes: WorkflowTemplateNodeType[]
  requiredEnv?: Record<string, string>
  optionalEnv?: Record<string, string>
}

export interface WorkflowTemplateAgentNodeInput {
  id: string
  title: string
  input: string
  agent?: (typeof WORKFLOW_TEMPLATE_AGENTS)[number]
  join?: 'all' | 'any'
  position: { x: number; y: number }
  /** Skill names resolved through the engine's workflow skill binding. */
  skills?: string[]
}

export interface WorkflowTemplateScriptNodeInput {
  id: string
  title: string
  code: string
  input?: string
  join?: 'all' | 'any'
  position: { x: number; y: number }
}

/** Agent node in the exact shape the engine's normalizeWorkflowNode returns. */
export function agentTemplateNode(args: WorkflowTemplateAgentNodeInput): WorkflowTemplateNode {
  return {
    id: args.id,
    type: 'agent',
    position: { ...args.position },
    data: {
      title: args.title,
      agent: args.agent || 'hermes',
      agentMode: 'scoped',
      provider: '',
      model: '',
      apiMode: '',
      reasoningEffort: 'default',
      input: args.input,
      skills: args.skills ? [...args.skills] : [],
      images: [],
      approvalRequired: false,
      orchestration: { join: args.join || 'all' },
    },
  }
}

/** Script node carrying the exact 5-key data contract {title,input,orchestration,runtime,code}. */
export function scriptTemplateNode(args: WorkflowTemplateScriptNodeInput): WorkflowTemplateNode {
  return {
    id: args.id,
    type: 'script',
    position: { ...args.position },
    data: {
      title: args.title,
      input: args.input || '',
      orchestration: { join: args.join || 'all' },
      runtime: WORKFLOW_TEMPLATE_SCRIPT_RUNTIME,
      code: args.code,
    },
  }
}

/** Edge in the exact shape the engine's normalizeWorkflowEdge returns. */
export function templateEdge(id: string, source: string, target: string): WorkflowTemplateEdge {
  return { id, source, target, orchestration: { route: 'success' } }
}

export function summarizeResearchWorkflowTemplate(template: ResearchWorkflowTemplate): ResearchWorkflowTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    profile: template.profile,
    steps: [...template.steps],
    nodeCount: template.nodes.length,
    edgeCount: template.edges.length,
    nodeTypes: [...new Set(template.nodes.map(node => node.type))],
    ...(template.requiredEnv ? { requiredEnv: { ...template.requiredEnv } } : {}),
    ...(template.optionalEnv ? { optionalEnv: { ...template.optionalEnv } } : {}),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function problemFor(templateId: string, message: string): string {
  return `workflow template ${templateId}: ${message}`
}

/**
 * Schema validation for a workflow template definition. Returns every problem
 * found (empty array = valid); it never throws, so HTTP layers decide how to
 * surface failures. Structural rules mirror the engine: node palette
 * {agent, script, validate, render}, script data contract
 * {title, input, orchestration, runtime:'node', code}, agent target fields
 * all-or-nothing, edge routes success|failure|always, and a connected graph
 * rooted at the entry nodes.
 */
export function validateTemplateDefinition(raw: unknown): string[] {
  if (!isPlainObject(raw)) return ['template must be an object']
  const template = raw as unknown as ResearchWorkflowTemplate
  const problems: string[] = []
  const templateId = typeof template.id === 'string' && template.id.trim() ? template.id.trim() : '<missing-id>'
  const add = (message: string) => problems.push(problemFor(templateId, message))

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(templateId) || templateId.startsWith('<')) {
    add('id must be a kebab-case slug of 2-64 characters')
  }
  if (typeof template.name !== 'string' || !template.name.trim()) add('name must be a non-empty string')
  if (typeof template.description !== 'string') add('description must be a string')
  if (typeof template.profile !== 'string' || !template.profile.trim()) add('profile must be a non-empty string')
  if (!Array.isArray(template.steps) || !template.steps.length || !template.steps.every(step => typeof step === 'string' && step.trim())) {
    add('steps must be a non-empty array of strings')
  }
  for (const envField of ['requiredEnv', 'optionalEnv'] as const) {
    const value = (template as unknown as Record<string, unknown>)[envField]
    if (value === undefined) continue
    if (!isPlainObject(value) || !Object.values(value).every(usage => typeof usage === 'string')) {
      add(`${envField} must map environment variable names to descriptions`)
    }
  }

  if (!isPlainObject(template.nodes) && !Array.isArray(template.nodes)) {
    add('nodes must be an array')
    return problems
  }
  const nodes = template.nodes
  if (!nodes.length) {
    add('nodes must not be empty')
    return problems
  }

  const nodeIds = new Set<string>()
  for (const rawNode of nodes) {
    if (!isPlainObject(rawNode)) {
      add('every node must be an object')
      continue
    }
    const node = rawNode as unknown as WorkflowTemplateNode
    const nodeId = typeof node.id === 'string' && node.id.trim() ? node.id.trim() : '<missing-node-id>'
    const nodeAdd = (message: string) => problems.push(problemFor(templateId, `node ${nodeId} ${message}`))
    if (nodeId !== node.id) nodeAdd('id must be a non-empty string')
    if (nodeIds.has(nodeId)) nodeAdd('is duplicated')
    nodeIds.add(nodeId)
    if (!(WORKFLOW_TEMPLATE_NODE_TYPES as readonly string[]).includes(node.type)) {
      nodeAdd(`has unsupported type: ${String(node.type)} (allowed: ${WORKFLOW_TEMPLATE_NODE_TYPES.join(', ')})`)
      continue
    }
    if (!isPlainObject(node.position)
      || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      nodeAdd('position must have finite x/y coordinates')
    }
    const data = node.data
    if (!isPlainObject(data)) {
      nodeAdd('data must be an object')
      continue
    }
    if (typeof data.title !== 'string' || !data.title.trim()) nodeAdd('data.title must be a non-empty string')
    if (typeof data.input !== 'string') nodeAdd('data.input must be a string')
    const orchestrationRecord = isPlainObject(data.orchestration) ? data.orchestration : null
    const join = orchestrationRecord ? orchestrationRecord.join : undefined
    if (!orchestrationRecord || (join !== 'all' && join !== 'any')) {
      nodeAdd('data.orchestration.join must be "all" or "any"')
    }

    const dataKeys = Object.keys(data).sort()
    if (node.type === 'script') {
      const expectedKeys = [...WORKFLOW_TEMPLATE_SCRIPT_DATA_KEYS].sort()
      if (dataKeys.length !== expectedKeys.length || dataKeys.some((key, index) => key !== expectedKeys[index])) {
        nodeAdd(`data keys must be exactly ${WORKFLOW_TEMPLATE_SCRIPT_DATA_KEYS.join(', ')}`)
      }
      if (data.runtime !== WORKFLOW_TEMPLATE_SCRIPT_RUNTIME) {
        nodeAdd(`data.runtime must be "${WORKFLOW_TEMPLATE_SCRIPT_RUNTIME}"`)
      }
      if (typeof data.code !== 'string' || !data.code.trim()) nodeAdd('data.code must be a non-empty script')
      continue
    }
    if (node.type === 'agent') {
      const allowedAgentKeys = [
        'title', 'input', 'orchestration', 'agent', 'agentMode', 'provider', 'model',
        'apiMode', 'reasoningEffort', 'skills', 'images', 'approvalRequired',
      ]
      const unknownKey = dataKeys.find(key => !allowedAgentKeys.includes(key))
      if (unknownKey) nodeAdd(`has unknown data key: ${unknownKey}`)
      if (typeof data.agent !== 'string' || !(WORKFLOW_TEMPLATE_AGENTS as readonly string[]).includes(data.agent)) {
        nodeAdd(`has unsupported agent runtime: ${String(data.agent)}`)
      }
      if (data.agentMode !== 'scoped' && data.agentMode !== 'global') {
        nodeAdd('data.agentMode must be "scoped" or "global"')
      } else if (data.agentMode === 'global' && !WORKFLOW_TEMPLATE_GLOBAL_MODE_AGENTS.has(String(data.agent))) {
        nodeAdd(`cannot use global mode with agent runtime: ${String(data.agent)}`)
      }
      const targetFieldCount = [data.provider, data.model, data.apiMode].filter(value => typeof value === 'string' && value.trim()).length
      if (targetFieldCount !== 0 && targetFieldCount !== 3) {
        nodeAdd('target must set provider, model, and apiMode together')
      }
      if (typeof data.apiMode === 'string' && data.apiMode && !(WORKFLOW_TEMPLATE_API_MODES as readonly string[]).includes(data.apiMode)) {
        nodeAdd(`has invalid apiMode: ${data.apiMode}`)
      }
      if (typeof data.reasoningEffort === 'string' && !(WORKFLOW_TEMPLATE_REASONING_EFFORTS as readonly string[]).includes(data.reasoningEffort)) {
        nodeAdd(`has invalid reasoningEffort: ${data.reasoningEffort}`)
      }
      if (data.skills !== undefined && !isStringArray(data.skills)) nodeAdd('data.skills must be a string array')
      if (data.images !== undefined && !isStringArray(data.images)) nodeAdd('data.images must be a string array')
      if (data.approvalRequired !== undefined && typeof data.approvalRequired !== 'boolean') {
        nodeAdd('data.approvalRequired must be a boolean')
      }
      continue
    }
    // validate/render nodes carry only the deterministic base keys.
    const unexpectedKey = dataKeys.find(key => !(WORKFLOW_TEMPLATE_DETERMINISTIC_DATA_KEYS as readonly string[]).includes(key))
    if (unexpectedKey) nodeAdd(`must not carry data key: ${unexpectedKey}`)
  }

  if (!Array.isArray(template.edges)) {
    add('edges must be an array')
    return problems
  }
  const edgeIds = new Set<string>()
  for (const rawEdge of template.edges) {
    if (!isPlainObject(rawEdge)) {
      add('every edge must be an object')
      continue
    }
    const edge = rawEdge as unknown as WorkflowTemplateEdge
    const edgeLabel = typeof edge.id === 'string' && edge.id ? edge.id : `${String(edge.source)}->${String(edge.target)}`
    if (edgeIds.has(edgeLabel)) add(`edge ${edgeLabel} is duplicated`)
    edgeIds.add(edgeLabel)
    if (!nodeIds.has(edge.source)) add(`edge ${edgeLabel} references unknown source node: ${String(edge.source)}`)
    if (!nodeIds.has(edge.target)) add(`edge ${edgeLabel} references unknown target node: ${String(edge.target)}`)
    if (!isPlainObject(edge.orchestration) || !(WORKFLOW_TEMPLATE_EDGE_ROUTES as readonly string[]).includes(edge.orchestration.route)) {
      add(`edge ${edgeLabel} orchestration.route must be one of: ${WORKFLOW_TEMPLATE_EDGE_ROUTES.join(', ')}`)
    }
  }

  // A template is a single pipeline: exactly one entry node (no incoming
  // edge), and every other node reachable from it. The engine supports
  // intentional loops via feedback edges, so cycles per se are not a template
  // error — extra roots and dangling subgraphs are.
  const incoming = new Set(template.edges.map(edge => (isPlainObject(edge) ? (edge as unknown as WorkflowTemplateEdge).target : '')))
  const adjacency = new Map<string, string[]>()
  for (const edge of template.edges) {
    if (!isPlainObject(edge)) continue
    const typed = edge as unknown as WorkflowTemplateEdge
    adjacency.set(typed.source, [...(adjacency.get(typed.source) || []), typed.target])
  }
  const entries = [...new Set(nodes
    .map(node => (isPlainObject(node) ? (node as unknown as WorkflowTemplateNode).id : ''))
    .filter(id => id && !incoming.has(id)))]
  if (entries.length !== 1) {
    add(`template must have exactly one entry node (no incoming edge), found: ${entries.length}`)
  } else {
    const reachable = new Set<string>()
    const queue = [entries[0]]
    while (queue.length) {
      const current = queue.pop()!
      if (reachable.has(current)) continue
      reachable.add(current)
      for (const next of adjacency.get(current) || []) queue.push(next)
    }
    for (const node of nodes) {
      if (!isPlainObject(node)) continue
      const id = (node as unknown as WorkflowTemplateNode).id
      if (!reachable.has(id)) add(`node ${id} is not reachable from the entry node`)
    }
  }

  return problems
}
