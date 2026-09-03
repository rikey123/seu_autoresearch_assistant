// Pure mapping from a research workflow template to the Studio
// createWorkflow request payload. Template definitions are authored in the
// exact node/edge shape the engine's normalize functions return (server
// contract, round-trip proven in tests/server/research-workflow-templates.test.ts),
// so the mapping is intentionally minimal: nodes/edges pass through untouched,
// the profile carries over, and only the name comes from the user.
import type { WorkflowCreateRequest } from '@/api/studio/workflows'
import type { ResearchWorkflowTemplate } from '@/api/studio/research-workflow-templates'

export function templateToWorkflowCreateRequest(
  template: Pick<ResearchWorkflowTemplate, 'name' | 'profile' | 'nodes' | 'edges'>,
  requestedName: string,
): WorkflowCreateRequest {
  const name = requestedName.trim() || template.name
  return {
    name,
    profile: template.profile || null,
    // Pass through as-is: the engine accepts these shapes verbatim. Copy the
    // arrays so the created payload never aliases the cached template object.
    nodes: [...template.nodes],
    edges: [...template.edges],
  }
}

/** Prefill for the "create from template" name input. */
export function suggestWorkflowName(
  template: Pick<ResearchWorkflowTemplate, 'name'>,
): string {
  return template.name
}
