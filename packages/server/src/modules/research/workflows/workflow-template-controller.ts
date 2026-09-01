// HTTP handlers for the research workflow template endpoints.
import type { Context } from 'koa'
import {
  getResearchWorkflowTemplate,
  listResearchWorkflowTemplates,
  validateResearchWorkflowTemplate,
} from './template-service'

function requiredTemplateId(ctx: Context): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: 'template id is required' }
  return null
}

function notFound(ctx: Context): void {
  ctx.status = 404
  ctx.body = { error: 'workflow template not found' }
}

export async function list(ctx: Context) {
  ctx.body = { templates: listResearchWorkflowTemplates() }
}

export async function get(ctx: Context) {
  const id = requiredTemplateId(ctx)
  if (!id) return
  const template = getResearchWorkflowTemplate(id)
  if (!template) {
    notFound(ctx)
    return
  }
  ctx.body = { template }
}

export async function validate(ctx: Context) {
  const id = requiredTemplateId(ctx)
  if (!id) return
  const validation = validateResearchWorkflowTemplate(id)
  if (!validation) {
    notFound(ctx)
    return
  }
  ctx.body = {
    template: { id: validation.template.id, name: validation.template.name },
    valid: validation.valid,
    problems: validation.problems,
    checked: { nodes: validation.template.nodes.length, edges: validation.template.edges.length },
  }
}
