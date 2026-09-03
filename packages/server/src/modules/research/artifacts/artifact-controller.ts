// HTTP handlers for the artifact registry endpoints.
import type { Context } from 'koa'
import {
  deleteArtifact,
  getArtifact,
  getArtifactPreview,
  listArtifacts,
  registerArtifact,
} from './artifact-service'

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function requiredId(ctx: Context): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: 'id is required' }
  return null
}

function rejectBadRequest(ctx: Context, err: unknown): void {
  const error = err as { status?: number; message?: string }
  ctx.status = typeof error?.status === 'number' ? error.status : 400
  ctx.body = { error: error?.message || 'invalid artifact request' }
}

export async function create(ctx: Context) {
  try {
    const artifact = registerArtifact(bodyRecord(ctx))
    ctx.status = 201
    ctx.body = { artifact }
  } catch (err) {
    rejectBadRequest(ctx, err)
  }
}

export async function list(ctx: Context) {
  const type = firstQueryValue(ctx.query.type as string | string[] | undefined)?.trim() || undefined
  const projectId = firstQueryValue(ctx.query.project_id as string | string[] | undefined)?.trim() || undefined
  try {
    const artifacts = listArtifacts({ type, project_id: projectId })
    ctx.body = { artifacts }
  } catch (err) {
    rejectBadRequest(ctx, err)
  }
}

export async function get(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const artifact = getArtifact(id)
  if (!artifact) {
    ctx.status = 404
    ctx.body = { error: 'artifact not found' }
    return
  }
  ctx.body = { artifact }
}

export async function getPreview(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const preview = getArtifactPreview(id)
  if (!preview) {
    ctx.status = 404
    ctx.body = { error: 'artifact not found' }
    return
  }
  // TODO(P2/T2.1): once workflow render nodes produce artifact files, serve the
  // real preview payload through the Studio generated-file preview mechanism;
  // for now the registry only carries preview metadata.
  ctx.body = { preview }
}

export async function remove(ctx: Context) {
  const id = requiredId(ctx)
  if (!id) return
  const deleted = deleteArtifact(id)
  if (!deleted) {
    ctx.status = 404
    ctx.body = { error: 'artifact not found' }
    return
  }
  ctx.body = { ok: true }
}
