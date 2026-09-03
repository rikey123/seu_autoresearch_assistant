import { request } from '../client'

// Client contract for the research skill pack surface
// (GET /api/studio/research/skillpacks[/:id], POST /:id/load, POST /:id/unload).
// Mirrors the server's skillpack-contract.ts shapes without importing server
// internals, exactly like the other research API clients.

/** Five-state install status reported per skill. */
export type ResearchSkillInstallStatus = 'installed' | 'outdated' | 'modified' | 'conflict' | 'missing'

export interface ResearchSkillStatus {
  /** Skill folder name (the identity templates bind through data.skills). */
  name: string
  title: string
  summary: string
  status: ResearchSkillInstallStatus
  /** True when the installed copy is owned by this loader (manifest entry). */
  managed: boolean
  /** Installed folder path; null when not present. */
  installedPath: string | null
}

export type ResearchSkillPackTarget = 'hermes' | 'claude'

export interface ResearchSkillPackStatus {
  id: string
  name: string
  description: string
  origin: string
  /** Directory skills are installed into for this status report. */
  targetDir: string
  target: ResearchSkillPackTarget
  /** True when every skill of the pack is installed and up to date. */
  loaded: boolean
  skills: ResearchSkillStatus[]
}

/** Server-side integrity signal: a registered pack whose asset folders are missing. */
export interface ResearchSkillPackAssetProblem {
  pack: string
  missing: string[]
}

export interface ResearchSkillPackListResult {
  packs: ResearchSkillPackStatus[]
  assetProblems: ResearchSkillPackAssetProblem[]
}

export type ResearchSkillInstallAction = 'installed' | 'updated' | 'skipped' | 'failed'

export interface ResearchSkillInstallResult {
  name: string
  action: ResearchSkillInstallAction
  /** Why an install was skipped or failed. */
  detail?: string
  installedPath?: string
}

export interface ResearchSkillPackLoadResult {
  pack: string
  target: ResearchSkillPackTarget
  targetDir: string
  profile: string
  installed: string[]
  updated: string[]
  skipped: ResearchSkillInstallResult[]
  results: ResearchSkillInstallResult[]
}

export type ResearchSkillRemoveAction = 'removed' | 'skipped' | 'missing'

export interface ResearchSkillRemoveResult {
  name: string
  action: ResearchSkillRemoveAction
  detail?: string
}

export interface ResearchSkillPackUnloadResult {
  pack: string
  target: ResearchSkillPackTarget
  targetDir: string
  profile: string
  removed: string[]
  skipped: ResearchSkillRemoveResult[]
}

export interface SkillPackOptions {
  profile?: string
  target?: ResearchSkillPackTarget
  /** Overwrite a locally modified installed copy (never applied automatically). */
  force?: boolean
}

/** Appends non-empty list options as query parameters (mirrors the controller's query fallback). */
function listQueryString(options: { profile?: string; target?: ResearchSkillPackTarget }): string {
  const query = new URLSearchParams()
  if (options.profile) query.set('profile', options.profile)
  if (options.target) query.set('target', options.target)
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

/** Status of every registered research skill pack (per-skill five-state). */
export async function listSkillPacks(options: { profile?: string; target?: ResearchSkillPackTarget } = {}): Promise<ResearchSkillPackListResult> {
  return request<ResearchSkillPackListResult>(`/api/studio/research/skillpacks${listQueryString(options)}`)
}

/** Status of a single pack; null when the id is unknown (server answers 404). */
export async function fetchSkillPack(id: string, options: { profile?: string; target?: ResearchSkillPackTarget } = {}): Promise<ResearchSkillPackStatus | null> {
  const res = await request<{ pack: ResearchSkillPackStatus | null }>(
    `/api/studio/research/skillpacks/${encodeURIComponent(id)}${listQueryString(options)}`,
  )
  return res.pack
}

/** Installs (or reloads) every skill of the pack into the target skills dir. */
export async function loadSkillPack(id: string, options: SkillPackOptions = {}): Promise<{ result: ResearchSkillPackLoadResult; pack: ResearchSkillPackStatus }> {
  const res = await request<{ result: ResearchSkillPackLoadResult; pack: ResearchSkillPackStatus }>(
    `/api/studio/research/skillpacks/${encodeURIComponent(id)}/load`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    },
  )
  return res
}

/** Removes research-managed skills of the pack; keeps user-modified copies unless force. */
export async function unloadSkillPack(id: string, options: SkillPackOptions = {}): Promise<{ result: ResearchSkillPackUnloadResult; pack: ResearchSkillPackStatus }> {
  const res = await request<{ result: ResearchSkillPackUnloadResult; pack: ResearchSkillPackStatus }>(
    `/api/studio/research/skillpacks/${encodeURIComponent(id)}/unload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    },
  )
  return res
}
