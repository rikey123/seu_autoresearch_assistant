// Research skill pack contract. A skill pack is a curated set of agent skills
// (SKILL.md folders) shipped inside the research domain and installed into the
// Agent skill directories the base already maintains: the Hermes profile
// skills dir (same layout the bundled-skill injector uses: one folder per
// skill, flat under <profileDir>/skills) and optionally ~/.claude/skills for
// the Claude family. No base code is modified — installation ownership is
// recorded in a research-owned manifest file next to the skills.

export const RESEARCH_SKILLPACK_MANIFEST_FILENAME = '.research-skillpacks.json'
export const RESEARCH_SKILLPACK_MANIFEST_VERSION = 1

/** Agent skill directory kinds the loader can install into. */
export const RESEARCH_SKILLPACK_TARGETS = ['hermes', 'claude'] as const
export type ResearchSkillPackTarget = (typeof RESEARCH_SKILLPACK_TARGETS)[number]

export interface ResearchSkillDefinition {
  /** Skill folder name under assets/ and under the target skills dir. */
  name: string
  /** Human-readable title. */
  title: string
  /** One-line summary surfaced through the API. */
  summary: string
}

export interface ResearchSkillPackDefinition {
  id: string
  name: string
  description: string
  /** Upstream the pack was curated from. */
  origin: string
  skills: ResearchSkillDefinition[]
}

export type ResearchSkillInstallStatus = 'installed' | 'outdated' | 'modified' | 'conflict' | 'missing'

export interface ResearchSkillStatus {
  name: string
  title: string
  summary: string
  status: ResearchSkillInstallStatus
  /** True when the installed copy is owned by this loader (manifest entry). */
  managed: boolean
  /** Installed folder path; null when not present. */
  installedPath: string | null
}

export interface ResearchSkillPackStatus {
  id: string
  name: string
  description: string
  origin: string
  /** Directory skills are installed into for this status report. */
  targetDir: string
  target: ResearchSkillPackTarget
  /** True when every skill is installed and up to date. */
  loaded: boolean
  skills: ResearchSkillStatus[]
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

export interface ResearchSkillPackManifest {
  version: number
  skills: Record<string, {
    pack: string
    sourceHash: string
    installedHash: string
    installedAt: string
  }>
}
