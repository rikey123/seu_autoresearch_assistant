// Registry services for the research workflow templates: list / get / validate.
// The Studio engine exposes no template-registration API, so templates stay
// research-domain owned; there is intentionally no runner here — running a
// template means instantiating it as a Studio workflow through the engine.
import {
  summarizeResearchWorkflowTemplate,
  validateTemplateDefinition,
  type ResearchWorkflowTemplate,
  type ResearchWorkflowTemplateSummary,
} from './template-contract'
import { RESEARCH_WORKFLOW_TEMPLATES } from './templates'

export function listResearchWorkflowTemplates(): ResearchWorkflowTemplateSummary[] {
  return RESEARCH_WORKFLOW_TEMPLATES.map(summarizeResearchWorkflowTemplate)
}

export function getResearchWorkflowTemplate(id: string): ResearchWorkflowTemplate | null {
  const needle = id.trim().toLowerCase()
  return RESEARCH_WORKFLOW_TEMPLATES.find(template => template.id === needle) || null
}

export interface ResearchWorkflowTemplateValidation {
  template: ResearchWorkflowTemplate
  problems: string[]
  valid: boolean
}

/**
 * Validates a registered template against the template contract. Structural
 * compatibility with the Studio engine's normalize functions is guaranteed by
 * tests/server/research-workflow-templates.test.ts, which round-trips every
 * node/edge through the real engine.
 */
export function validateResearchWorkflowTemplate(id: string): ResearchWorkflowTemplateValidation | null {
  const template = getResearchWorkflowTemplate(id)
  if (!template) return null
  const problems = validateTemplateDefinition(template)
  return { template, problems, valid: problems.length === 0 }
}
