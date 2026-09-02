// HTTP handlers for the research skill pack endpoints.
import type { Context } from 'koa'
import {
  findMissingSkillAssets,
  getResearchSkillPack,
  getSkillPackStatus,
  listSkillPackStatuses,
  loadSkillPack,
  unloadSkillPack,
} from './skillpack-service'

function packId(ctx: Context): string | null {
  const id = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: 'skill pack id is required' }
  return null
}

function bodyOptions(ctx: Context): { profile?: unknown; target?: unknown; force?: unknown } {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const query = (ctx.query || {}) as Record<string, string>
  return {
    profile: body.profile ?? query.profile,
    target: body.target ?? query.target,
    force: body.force,
  }
}

export async function health(ctx: Context) {
  ctx.body = { ok: true, subdomain: 'skillpacks' }
}

export async function list(ctx: Context) {
  const options = bodyOptions(ctx)
  const packs = await listSkillPackStatuses(options)
  const shippedMissing = packs
    .map(pack => ({ pack, missing: findMissingSkillAssets(pack) }))
    .filter(entry => entry.missing.length > 0)
  ctx.body = {
    packs,
    // Server-side integrity signal: a registered pack whose asset folders are
    // missing means a broken build/deployment, not a user problem.
    assetProblems: shippedMissing.map(entry => ({
      pack: entry.pack.id,
      missing: entry.missing,
    })),
  }
}

export async function get(ctx: Context) {
  const id = packId(ctx)
  if (!id) return
  const status = await getSkillPackStatus(id, bodyOptions(ctx))
  if (!status) {
    ctx.status = 404
    ctx.body = { error: 'skill pack not found' }
    return
  }
  ctx.body = { pack: status }
}

export async function load(ctx: Context) {
  const id = packId(ctx)
  if (!id) return
  const options = bodyOptions(ctx)
  const result = await loadSkillPack(id, options)
  if (!result) {
    ctx.status = 404
    ctx.body = { error: 'skill pack not found' }
    return
  }
  const status = await getSkillPackStatus(id, options)
  ctx.body = { result, pack: status }
}

export async function unload(ctx: Context) {
  const id = packId(ctx)
  if (!id) return
  const options = bodyOptions(ctx)
  if (!getResearchSkillPack(id)) {
    ctx.status = 404
    ctx.body = { error: 'skill pack not found' }
    return
  }
  const result = await unloadSkillPack(id, options)
  const status = await getSkillPackStatus(id, options)
  ctx.body = { result, pack: status }
}
