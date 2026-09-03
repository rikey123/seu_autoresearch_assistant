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
  requiredEnv?: Record<string, string>
  optionalEnv?: Record<string, string>
}

export interface ResearchWorkflowTemplate extends ResearchWorkflowTemplateSummary {
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
