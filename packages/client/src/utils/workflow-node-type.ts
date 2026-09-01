export const WORKFLOW_NODE_TYPES = ['agent', 'script', 'validate', 'render'] as const
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number]

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

export const WORKFLOW_NODE_RUNTIME_DATA_KEYS: readonly string[] = ['status', 'statusError', 'readonly']

export function isKnownWorkflowNodeType(type: unknown): type is WorkflowNodeType {
  return typeof type === 'string' && (WORKFLOW_NODE_TYPES as readonly string[]).includes(type)
}

export function normalizeWorkflowNodeType(raw: unknown): string {
  return typeof raw === 'string' && raw ? raw : 'agent'
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

export function normalizeDeterministicWorkflowNodeData(rawData: unknown, title: string): Record<string, unknown> {
  const data = rawData && typeof rawData === 'object' ? rawData as Record<string, unknown> : {}
  return {
    ...stripWorkflowAgentNodeDataFields(data),
    title,
    status: 'idle' as const,
  }
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
  const { title, ...typeFields } = stripWorkflowAgentNodeDataFields(node.data)
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
