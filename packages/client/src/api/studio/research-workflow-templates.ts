import { request } from '../client'

// Client contract for the research workflow template registry
// (GET /api/studio/research/workflows/templates[/:id]). Mirrors the server's
// ResearchWorkflowTemplateSummary / ResearchWorkflowTemplate shapes without
// importing server internals. Template nodes/edges are stored server-side in
// the exact shape the Studio workflow engine's normalize functions return, so
// a template can be instantiated as a Studio workflow without transformation
// (proven by tests/server/research-workflow-templates.test.ts).

export type WorkflowTemplateNodeType = 'agent' | 'script' | 'validate' | 'render'

export interface ResearchWorkflowTemplateSummary {
  id: string
  name: string
  description: string
  profile: string
  /** Ordered human-readable pipeline stages, 1:1 with the node titles. */
  steps: string[]
  nodeCount: number
  edgeCount: number
  nodeTypes: WorkflowTemplateNodeType[]
  /**
   * Skill names bound by the template's agent nodes (deduped, first-seen
   * order), summarized server-side from nodes[].data.skills. The hub maps
   * each name onto the skillpack status list for its load-state tag.
   */
  skills: string[]
  requiredEnv?: Record<string, string>
  optionalEnv?: Record<string, string>
}

/**
 * Full template definition exactly as GET /templates/:id returns it: the
 * node/edge payload plus the descriptive fields. Bound skills live inside
 * nodes[].data.skills (the hub computes the required set from there when
 * instantiating a template); the summarized `skills` list only exists on
 * ResearchWorkflowTemplateSummary.
 */
export interface ResearchWorkflowTemplate {
  id: string
  name: string
  description: string
  profile: string
  steps: string[]
  requiredEnv?: Record<string, string>
  optionalEnv?: Record<string, string>
  nodes: unknown[]
  edges: unknown[]
}

export async function listResearchWorkflowTemplates(): Promise<ResearchWorkflowTemplateSummary[]> {
  const res = await request<{ templates: ResearchWorkflowTemplateSummary[] }>(
    '/api/studio/research/workflows/templates',
  )
  return res.templates
}

export async function fetchResearchWorkflowTemplate(id: string): Promise<ResearchWorkflowTemplate> {
  const res = await request<{ template: ResearchWorkflowTemplate }>(
    `/api/studio/research/workflows/templates/${encodeURIComponent(id)}`,
  )
  return res.template
}
