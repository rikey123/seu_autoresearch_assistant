// Research skill pack loader: installs the bundled research skill folders into
// the Agent skill directories the base mechanism already scans.
//
// Channel survey (why this lands where it lands, with zero base changes):
// - The base bundled-skill injector (modules/hermes/services/skills/injector)
//   copies packages/skills folders flat into <hermesRoot>/skills and
//   <hermesRoot>/profiles/<name>/skills; the Hermes skill list controller and
//   the workflow skill resolver both discover skills from exactly
//   <profileDir>/skills via the studio/public profile-config facade.
// - This service therefore installs into that same directory using the same
//   flat layout, and records ownership in its own manifest file
//   (.research-skillpacks.json) so install / reload / unload never touch
//   skills it does not own (base-injected, hub-installed, or user-created).
// - Research may only consume Studio through contracts/public facades, so the
//   profile directory comes from studio/public/profile-config and file helpers
//   from studio/public/files — the same facades the Hermes skill controller
//   itself uses.
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listFilesRecursive, safeReadFile } from '../../studio/public/files'
import { getProfileDir, listProfileNames } from '../../studio/public/profile-config'
import {
  RESEARCH_SKILLPACK_MANIFEST_FILENAME,
  RESEARCH_SKILLPACK_MANIFEST_VERSION,
  RESEARCH_SKILLPACK_TARGETS,
  type ResearchSkillInstallAction,
  type ResearchSkillInstallResult,
  type ResearchSkillPackDefinition,
  type ResearchSkillPackLoadResult,
  type ResearchSkillPackManifest,
  type ResearchSkillPackStatus,
  type ResearchSkillPackTarget,
  type ResearchSkillPackUnloadResult,
  type ResearchSkillRemoveAction,
  type ResearchSkillRemoveResult,
  type ResearchSkillStatus,
} from './skillpack-contract'

// The nature-skills curated subset (DESIGN.md §3): five high-frequency research
// skills kept loadable for agents, with the drawing conventions skill also
// bound by the figure-drawing workflow template's agent node.
const NATURE_RESEARCH_PACK: ResearchSkillPackDefinition = {
  id: 'nature-research',
  name: 'Nature 科研技能精选包',
  description: 'nature-skills 精选子集：论文精读、图表规范、文献综述提纲、审稿式自查、科研绘图规范；装载后可被 Agent 通过技能机制直接调用。',
  origin: 'nature-skills (Yuan1z0825) 精选改写；科研绘图规范另融合 scientific-illustrator 的绘制→检查→修正循环',
  skills: [
    { name: 'paper-deep-reading', title: '论文精读', summary: '三遍读法（概览→细读→批判复盘）与结构化阅读笔记模板。' },
    { name: 'figure-standards', title: '图表规范', summary: '期刊图表规格：尺寸、字号、线宽、色盲安全色板与导出要求。' },
    { name: 'literature-review-outline', title: '文献综述提纲', summary: '主题式综述提纲模板 + 综合矩阵 + 引用纪律。' },
    { name: 'reviewer-self-check', title: '审稿式自查', summary: '投稿前审稿人视角逐项自查，输出 Major/Minor 分级问题清单。' },
    { name: 'scientific-figure-style', title: '科研绘图规范', summary: '绘制→检查→修正循环与独立 SVG 输出约定；figure-drawing 工作流绘图节点绑定此技能。' },
  ],
}

/** Registered research skill packs, keyed lookup by `id`. */
export const RESEARCH_SKILL_PACKS: readonly ResearchSkillPackDefinition[] = [NATURE_RESEARCH_PACK]

export function listResearchSkillPackDefinitions(): ResearchSkillPackDefinition[] {
  return RESEARCH_SKILL_PACKS.map(pack => ({ ...pack, skills: pack.skills.map(skill => ({ ...skill })) }))
}

export function getResearchSkillPack(id: string): ResearchSkillPackDefinition | null {
  const needle = id.trim().toLowerCase()
  return RESEARCH_SKILL_PACKS.find(pack => pack.id === needle) || null
}

/** Skill folders shipped with the server (assets/<skill-name>/SKILL.md). */
function skillsAssetsRoot(): string {
  return join(__dirname, 'assets')
}

function assetSkillDir(skillName: string): string {
  return join(skillsAssetsRoot(), skillName)
}

export function resolveSkillPackTargetDir(target: ResearchSkillPackTarget, profile: string): string {
  if (target === 'claude') return join(homedir(), '.claude', 'skills')
  // Hermes profile skills dir — the same path the Hermes skill list and the
  // workflow skill resolver scan; getProfileDir('default') is the Hermes root.
  return join(getProfileDir(profile || 'default'), 'skills')
}

function normalizeTarget(target: unknown): ResearchSkillPackTarget {
  const value = String(target || 'hermes').trim().toLowerCase()
  return ((RESEARCH_SKILLPACK_TARGETS as readonly string[]).includes(value) ? value : 'hermes') as ResearchSkillPackTarget
}

/**
 * Option validation error for user-supplied skillpack options (profile).
 * The controllers map this to HTTP 400 with the message.
 */
export class SkillpackOptionError extends Error {}

function knownProfileNames(): string[] {
  try {
    return listProfileNames()
  } catch {
    return ['default']
  }
}

/**
 * Normalize and validate the profile option. The profile selects the target
 * directory on disk, so it must be one of the known profile names — an
 * arbitrary string would otherwise resolve to whatever directory happens to
 * exist under the Hermes root. Both valid targets (hermes, claude) keep
 * working: an omitted profile means 'default', which is always known.
 */
function normalizeProfile(profile: unknown): string {
  const name = String(profile || 'default').trim() || 'default'
  const known = knownProfileNames()
  if (!known.includes(name)) {
    throw new SkillpackOptionError(
      `unknown profile "${name}"; load/unload accepts only known profiles (${known.join(', ')})`,
    )
  }
  return name
}

/** sha256 over the skill folder contents (sorted rel path + bytes). */
async function hashSkillDir(dir: string): Promise<string | null> {
  try {
    await stat(dir)
  } catch {
    return null
  }
  const hasher = createHash('sha256')
  const files = (await listFilesRecursive(dir, '')).slice()
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const file of files) {
    hasher.update(`file\0${file.path}\0`)
    hasher.update(await readFile(join(dir, file.path)))
    hasher.update('\0')
  }
  return hasher.digest('hex')
}

async function readManifest(skillsDir: string): Promise<ResearchSkillPackManifest> {
  const raw = await safeReadFile(join(skillsDir, RESEARCH_SKILLPACK_MANIFEST_FILENAME))
  if (!raw) return { version: RESEARCH_SKILLPACK_MANIFEST_VERSION, skills: {} }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.skills && typeof parsed.skills === 'object') {
      return { version: RESEARCH_SKILLPACK_MANIFEST_VERSION, skills: parsed.skills }
    }
  } catch { /* rewrite a malformed manifest on the next write */ }
  return { version: RESEARCH_SKILLPACK_MANIFEST_VERSION, skills: {} }
}

async function writeManifest(skillsDir: string, manifest: ResearchSkillPackManifest): Promise<void> {
  await mkdir(skillsDir, { recursive: true })
  const sorted: ResearchSkillPackManifest = { version: manifest.version, skills: {} }
  for (const name of Object.keys(manifest.skills).sort()) {
    sorted.skills[name] = manifest.skills[name]
  }
  await writeFile(join(skillsDir, RESEARCH_SKILLPACK_MANIFEST_FILENAME), `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8')
}

async function installSkillDir(sourceSkillDir: string, targetSkillDir: string): Promise<void> {
  await mkdir(targetSkillDir, { recursive: true })
  await cp(sourceSkillDir, targetSkillDir, { recursive: true })
}

async function dirIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Validates that every declared skill actually ships an assets/<name>/SKILL.md. */
export function findMissingSkillAssets(pack: ResearchSkillPackDefinition): string[] {
  const missing: string[] = []
  for (const skill of pack.skills) {
    const assetDir = assetSkillDir(skill.name)
    if (!existsSync(assetDir) || !existsSync(join(assetDir, 'SKILL.md'))) {
      missing.push(skill.name)
    }
  }
  return missing
}

export async function getSkillPackStatus(packId: string, options: { profile?: unknown; target?: unknown } = {}): Promise<ResearchSkillPackStatus | null> {
  const pack = getResearchSkillPack(packId)
  if (!pack) return null
  const target = normalizeTarget(options.target)
  const profile = normalizeProfile(options.profile)
  const targetDir = resolveSkillPackTargetDir(target, profile)
  const manifest = await readManifest(targetDir)

  const skills: ResearchSkillStatus[] = []
  for (const skill of pack.skills) {
    const installedPath = join(targetDir, skill.name)
    const entry = manifest.skills[skill.name]
    const dirExists = await dirIsDirectory(installedPath)
    let status: ResearchSkillStatus['status'] = 'missing'
    let managed = false
    if (dirExists && entry) {
      managed = true
      const currentHash = await hashSkillDir(installedPath)
      if (currentHash === null || currentHash !== entry.installedHash) {
        status = 'modified'
      } else {
        const sourceHash = await hashSkillDir(assetSkillDir(skill.name))
        status = sourceHash !== null && sourceHash === entry.sourceHash ? 'installed' : 'outdated'
      }
    } else if (dirExists) {
      status = 'conflict'
    }
    skills.push({
      name: skill.name,
      title: skill.title,
      summary: skill.summary,
      status,
      managed,
      installedPath: dirExists ? installedPath : null,
    })
  }

  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    origin: pack.origin,
    target,
    targetDir,
    loaded: skills.every(skill => skill.status === 'installed'),
    skills,
  }
}

export async function listSkillPackStatuses(options: { profile?: unknown; target?: unknown } = {}): Promise<ResearchSkillPackStatus[]> {
  const statuses: ResearchSkillPackStatus[] = []
  for (const pack of RESEARCH_SKILL_PACKS) {
    const status = await getSkillPackStatus(pack.id, options)
    if (status) statuses.push(status)
  }
  return statuses
}

/**
 * Installs (or reloads) every skill of a pack into the target skills dir.
 * Never overwrites content this loader does not own: unmanaged folders with a
 * colliding name are reported as conflicts and left untouched.
 */
export async function loadSkillPack(packId: string, options: { profile?: unknown; target?: unknown; force?: unknown } = {}): Promise<ResearchSkillPackLoadResult | null> {
  const pack = getResearchSkillPack(packId)
  if (!pack) return null
  const target = normalizeTarget(options.target)
  const profile = normalizeProfile(options.profile)
  const force = options.force === true
  const targetDir = resolveSkillPackTargetDir(target, profile)
  await mkdir(targetDir, { recursive: true })
  const manifest = await readManifest(targetDir)

  const installed: string[] = []
  const updated: string[] = []
  const skipped: ResearchSkillInstallResult[] = []
  const results: ResearchSkillInstallResult[] = []
  let manifestChanged = false

  for (const skill of pack.skills) {
    const push = (action: ResearchSkillInstallAction, detail?: string): ResearchSkillInstallResult => {
      const result: ResearchSkillInstallResult = { name: skill.name, action, ...(detail ? { detail } : {}) }
      results.push(result)
      return result
    }
    const sourceSkillDir = assetSkillDir(skill.name)
    const targetSkillDir = join(targetDir, skill.name)
    if (!await dirIsDirectory(sourceSkillDir)) {
      skipped.push(push('failed', `skill asset folder is missing in the research skillpack assets: ${skill.name}`))
      continue
    }
    const sourceHash = await hashSkillDir(sourceSkillDir)
    const entry = manifest.skills[skill.name]
    const targetExists = await dirIsDirectory(targetSkillDir)

    if (targetExists && !entry) {
      const result = push('skipped', `target already exists and is not research-skillpack managed: ${targetSkillDir}`)
      skipped.push(result)
      continue
    }

    if (targetExists && entry) {
      const currentHash = await hashSkillDir(targetSkillDir)
      // An unchanged managed copy stays untouched even under force: content is
      // provably identical to the source. Force only overrides the refusal to
      // clobber a copy the user modified after install — regardless of whether
      // the pack source moved on, so a user edit is never silently overwritten
      // by an outdated-source check falling through (the status surface
      // reports exactly this combined state as "modified", mirroring the
      // unload guard below).
      if (currentHash === entry.installedHash && entry.sourceHash === sourceHash) {
        skipped.push(push('skipped', 'already installed and up to date'))
        continue
      }
      if (currentHash !== entry.installedHash && !force) {
        skipped.push(push('skipped', 'installed copy was modified after install; pass force:true to overwrite'))
        continue
      }
    }

    try {
      if (targetExists) await rm(targetSkillDir, { recursive: true, force: true })
      await installSkillDir(sourceSkillDir, targetSkillDir)
    } catch (error) {
      skipped.push(push('failed', `install failed: ${error instanceof Error ? error.message : String(error)}`))
      continue
    }
    const installedHash = await hashSkillDir(targetSkillDir)
    manifest.skills[skill.name] = {
      pack: pack.id,
      sourceHash: sourceHash || '',
      installedHash: installedHash || '',
      installedAt: new Date().toISOString(),
    }
    manifestChanged = true
    if (entry) {
      updated.push(skill.name)
      push('updated')
    } else {
      installed.push(skill.name)
      push('installed')
    }
  }

  if (manifestChanged) await writeManifest(targetDir, manifest)
  return { pack: pack.id, target, targetDir, profile, installed, updated, skipped, results }
}

/**
 * Removes every research-managed skill of a pack from the target skills dir.
 * User-modified copies are kept unless force is set.
 */
export async function unloadSkillPack(packId: string, options: { profile?: unknown; target?: unknown; force?: unknown } = {}): Promise<ResearchSkillPackUnloadResult | null> {
  const pack = getResearchSkillPack(packId)
  if (!pack) return null
  const target = normalizeTarget(options.target)
  const profile = normalizeProfile(options.profile)
  const force = options.force === true
  const targetDir = resolveSkillPackTargetDir(target, profile)
  const manifest = await readManifest(targetDir)

  const removed: string[] = []
  const skipped: ResearchSkillRemoveResult[] = []
  let manifestChanged = false

  for (const skill of pack.skills) {
    const push = (action: ResearchSkillRemoveAction, detail?: string): ResearchSkillRemoveResult => {
      const result: ResearchSkillRemoveResult = { name: skill.name, action, ...(detail ? { detail } : {}) }
      skipped.push(result)
      return result
    }
    const entry = manifest.skills[skill.name]
    const targetSkillDir = join(targetDir, skill.name)
    if (!entry) {
      if (await dirIsDirectory(targetSkillDir)) {
        push('skipped', 'folder exists but is not research-skillpack managed; left untouched')
      } else {
        push('missing', 'not installed')
      }
      continue
    }
    const currentHash = await hashSkillDir(targetSkillDir)
    if (currentHash !== null && currentHash !== entry.installedHash && !force) {
      push('skipped', 'installed copy was modified; pass force:true to remove anyway')
      continue
    }
    await rm(targetSkillDir, { recursive: true, force: true })
    delete manifest.skills[skill.name]
    manifestChanged = true
    removed.push(skill.name)
  }

  if (manifestChanged) await writeManifest(targetDir, manifest)
  return { pack: pack.id, target, targetDir, profile, removed, skipped }
}

/** Names of the skill folders currently shipped under assets/. */
export async function listShippedSkillAssetNames(): Promise<string[]> {
  try {
    const entries = await readdir(skillsAssetsRoot(), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort()
  } catch {
    return []
  }
}
