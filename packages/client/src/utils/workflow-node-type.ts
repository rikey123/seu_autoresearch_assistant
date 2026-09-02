export const WORKFLOW_NODE_TYPES = ['agent', 'script', 'validate', 'render'] as const
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number]

export const WORKFLOW_DETERMINISTIC_NODE_TYPES = ['script', 'validate', 'render'] as const
export type WorkflowDeterministicNodeType = (typeof WORKFLOW_DETERMINISTIC_NODE_TYPES)[number]

// Agent nodes also carry `input` and `orchestration`, but for deterministic nodes both
// keys belong to the server script contract and must survive normalize/serialize.
export const WORKFLOW_DETERMINISTIC_PRESERVED_DATA_KEYS: readonly string[] = ['input', 'orchestration']

export const WORKFLOW_SCRIPT_NODE_RUNTIME = 'node' as const

export const WORKFLOW_AGENT_NODE_DATA_KEYS: readonly string[] = [
  'agent',
  'agentMode',
  'provider',
  'model',
  'apiMode',
  'reasoningEffort',
  'input',
  'skills',
  'images',
  'approvalRequired',
  'orchestration',
  'agentOptions',
  'skillOptions',
  'skillsLoading',
  'modelGroups',
  'onUpdate',
  'onUploadImages',
]

// Runtime-only keys are canvas session state (playback status, client-side
// validation flags) and are never persisted user data.
export const WORKFLOW_NODE_RUNTIME_DATA_KEYS: readonly string[] = ['status', 'statusError', 'readonly', 'scriptRuntimeInvalid']

// UI-only keys that live on canvas node data but are never persisted user data:
// runtime playback state plus the edit callbacks attached when a node is loaded.
export const WORKFLOW_NODE_UI_ONLY_DATA_KEYS: readonly string[] = [
  ...WORKFLOW_NODE_RUNTIME_DATA_KEYS,
  'onUpdate',
  'onUploadImages',
]

export function isKnownWorkflowNodeType(type: unknown): type is WorkflowNodeType {
  return typeof type === 'string' && (WORKFLOW_NODE_TYPES as readonly string[]).includes(type)
}

export function normalizeWorkflowNodeType(raw: unknown): string {
  return typeof raw === 'string' && raw ? raw : 'agent'
}

export function isDeterministicWorkflowNodeType(type: unknown): type is WorkflowDeterministicNodeType {
  return typeof type === 'string' && (WORKFLOW_DETERMINISTIC_NODE_TYPES as readonly string[]).includes(type)
}

export function stripWorkflowAgentNodeDataFields(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (WORKFLOW_AGENT_NODE_DATA_KEYS.includes(key)) continue
    if (WORKFLOW_NODE_RUNTIME_DATA_KEYS.includes(key)) continue
    result[key] = value
  }
  return result
}

export function stripWorkflowDeterministicNodeDataFields(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (WORKFLOW_AGENT_NODE_DATA_KEYS.includes(key) && !WORKFLOW_DETERMINISTIC_PRESERVED_DATA_KEYS.includes(key)) continue
    if (WORKFLOW_NODE_RUNTIME_DATA_KEYS.includes(key)) continue
    result[key] = value
  }
  return result
}

// Unknown node types are forward-compat payloads: their data must round-trip
// untouched, so only strip keys that are provably canvas UI plumbing, never
// the agent-key list (an unknown type may legitimately carry keys like
// agent/model/provider as its own domain data).
export function stripWorkflowUnknownNodeDataFields(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (WORKFLOW_NODE_UI_ONLY_DATA_KEYS.includes(key)) continue
    result[key] = value
  }
  return result
}

export function createDeterministicWorkflowNodeData(type: WorkflowDeterministicNodeType, title: string): Record<string, unknown> {
  if (type === 'script') {
    return {
      title,
      input: '',
      orchestration: { join: 'all' },
      runtime: WORKFLOW_SCRIPT_NODE_RUNTIME,
      code: '',
    }
  }
  return { title }
}

export interface WorkflowNodeFrame {
  position: { x: number; y: number }
  dragHandle: string
  storedWidth: string | null
  storedHeight: string | null
}

export function normalizeWorkflowNodeFrame(raw: unknown, index: number): WorkflowNodeFrame {
  const record = raw && typeof raw === 'object' ? raw as Record<string, any> : {}
  const rawPosition = record.position && typeof record.position === 'object' ? record.position as Record<string, unknown> : {}
  const rawX = Number(rawPosition.x)
  const rawY = Number(rawPosition.y)
  const rawStyle = record.style && typeof record.style === 'object' ? record.style as Record<string, unknown> : {}
  return {
    position: {
      x: Number.isFinite(rawX) ? rawX : 80 + index * 320,
      y: Number.isFinite(rawY) ? rawY : 120,
    },
    dragHandle: typeof record.dragHandle === 'string' && record.dragHandle ? record.dragHandle : '.node-header',
    storedWidth: typeof rawStyle.width === 'string' ? rawStyle.width : null,
    storedHeight: typeof rawStyle.height === 'string' ? rawStyle.height : null,
  }
}

// Three-path data normalization on load/serialize:
//   (a) agent nodes — handled by WorkflowView (behavior unchanged);
//   (b) known deterministic types (script/validate/render) — contract normalization;
//   (c) unknown types — lossless passthrough, only canvas UI plumbing removed.
export function normalizeDeterministicWorkflowNodeData(
  rawData: unknown,
  title: string,
  nodeType: string = 'script',
): Record<string, unknown> {
  const data = rawData && typeof rawData === 'object' ? rawData as Record<string, unknown> : {}
  if (!isDeterministicWorkflowNodeType(nodeType)) {
    return {
      ...stripWorkflowUnknownNodeDataFields(data),
      title,
    }
  }
  return {
    ...stripWorkflowDeterministicNodeDataFields(data),
    title,
    status: 'idle' as const,
  }
}

// Load-time script canonicalization mirroring the server canonicalizer: script
// nodes require runtime === 'node'. A mismatched or missing runtime is flagged
// as invalid instead of being silently rewritten, so the user's stored data is
// preserved and saving is blocked with a clear message until it is fixed.
export function canonicalizeScriptWorkflowNodeData(
  rawData: unknown,
  title: string,
): Record<string, unknown> & { scriptRuntimeInvalid: boolean } {
  const normalized = normalizeDeterministicWorkflowNodeData(rawData, title, 'script')
  const runtime = typeof normalized.runtime === 'string' ? normalized.runtime : ''
  if (runtime === WORKFLOW_SCRIPT_NODE_RUNTIME) {
    const { scriptRuntimeInvalid: _flag, ...data } = normalized as Record<string, unknown> & { scriptRuntimeInvalid?: boolean }
    return { ...data, scriptRuntimeInvalid: false }
  }
  return { ...normalized, scriptRuntimeInvalid: true }
}

export interface WorkflowCanvasNodeSnapshot {
  id: string
  type: string
  position: { x: number; y: number }
  dragHandle?: string
  style?: { width?: string; height?: string } | null
  data: Record<string, unknown>
}

export function serializeDeterministicWorkflowNode(node: WorkflowCanvasNodeSnapshot): Record<string, unknown> {
  if (!isDeterministicWorkflowNodeType(node.type)) {
    // Unknown node type: lossless round-trip — persist data as-is minus the
    // canvas UI callbacks. The title stays because it is user-visible data.
    return {
      id: node.id,
      type: node.type,
      position: { ...node.position },
      dragHandle: node.dragHandle,
      style: { ...(node.style || {}) },
      data: stripWorkflowUnknownNodeDataFields(node.data),
    }
  }
  const { title, ...typeFields } = stripWorkflowDeterministicNodeDataFields(node.data)
  return {
    id: node.id,
    type: node.type,
    position: { ...node.position },
    dragHandle: node.dragHandle,
    style: { ...(node.style || {}) },
    data: {
      ...(title === undefined ? {} : { title }),
      ...typeFields,
    },
  }
}
