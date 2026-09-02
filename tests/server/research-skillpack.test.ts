import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Research skill pack loading: install the shipped nature-research skill
// folders into the Hermes profile skills directory and prove they surface in
// the SAME enumeration and runtime binding channels the Agent uses:
// - the Hermes skill list controller (GET /api/hermes/skills) scans
//   <profileDir>/skills — loaded packs must appear there;
// - the Studio workflow skill resolver (the code path that injects skill
//   content into workflow agent runs) must resolve the loaded skills.
const originalHermesHome = process.env.HERMES_HOME
const originalTestDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalWebUiHome = process.env.HERMES_WEB_UI_HOME
const originalStateDir = process.env.HERMES_WEBUI_STATE_DIR
const testRoot = mkdtempSync(join(tmpdir(), 'research-skillpack-'))
const hermesRoot = join(testRoot, 'hermes-root')
process.env.HERMES_HOME = hermesRoot
process.env.HERMES_WEB_UI_TEST_DB_DIR = join(testRoot, 'db')
process.env.HERMES_WEB_UI_HOME = join(testRoot, 'home')
process.env.HERMES_WEBUI_STATE_DIR = join(testRoot, 'home')

const ASSETS_DIR = join(__dirname, '../../packages/server/src/modules/research/skillpacks/assets')
const SKILLPACK_ROUTES = '../../packages/server/src/modules/research/skillpacks/index'
const SKILLPACK_SERVICE = '../../packages/server/src/modules/research/skillpacks/skillpack-service'
const PROFILE_CONFIG = '../../packages/server/src/modules/studio/public/profile-config'
const HERMES_SKILLS_CONTROLLER = '../../packages/server/src/modules/hermes/controllers/skills'
const SKILL_RESOLVER = '../../packages/server/src/modules/studio/services/workflow/skill-resolver'

type SkillpackRoutesModule = typeof import('../../packages/server/src/modules/research/skillpacks/index')
type SkillpackServiceModule = typeof import('../../packages/server/src/modules/research/skillpacks/skillpack-service')

let routes: SkillpackRoutesModule
let service: SkillpackServiceModule

async function dispatch(method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
  const dispatchRoute = routes.skillpacksRoutes.routes()
  const ctx: any = {
    method,
    path,
    query,
    params: {},
    request: { body },
    state: {},
    status: 200,
    body: undefined,
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

beforeAll(async () => {
  const { configureProfileConfig } = await import(PROFILE_CONFIG)
  // Mirror the bootstrap wiring (agent-profile-adapter) against an isolated
  // HERMES_HOME so profile dirs agree between the research loader (facade)
  // and the Hermes-internal profile helpers (env-driven).
  configureProfileConfig({
    buildModelGroups: () => ({ default: '', groups: [] }),
    getProfilesBaseDir: () => hermesRoot,
    getProfileDir: (profile: string) => {
      // Read the env at call time so tests can retarget the profile root the
      // same way the Hermes-internal helpers do.
      const root = process.env.HERMES_HOME || hermesRoot
      if (!profile || profile === 'default') return root
      const named = join(root, 'profiles', profile)
      return existsSync(named) ? named : root
    },
    getActiveProfileName: () => 'default',
    listProfileNames: () => ['default'],
    providerEnvironmentMap: {},
    readConfigYaml: async () => ({}),
    readConfigYamlForProfile: async () => ({}),
    safeReadFile: async (filePath: string) => {
      try { return readFileSync(filePath, 'utf-8') } catch { return null }
    },
    saveEnvValue: async () => {},
    saveEnvValueForProfile: async () => {},
    updateConfigYaml: async (updater: (config: Record<string, any>) => unknown) => updater({}),
    updateConfigYamlForProfile: async (_profile: string, updater: (config: Record<string, any>) => unknown) => updater({}),
  })
  routes = await import(SKILLPACK_ROUTES)
  service = await import(SKILLPACK_SERVICE)
})

afterAll(() => {
  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  restore('HERMES_HOME', originalHermesHome)
  restore('HERMES_WEB_UI_TEST_DB_DIR', originalTestDbDir)
  restore('HERMES_WEB_UI_HOME', originalWebUiHome)
  restore('HERMES_WEBUI_STATE_DIR', originalStateDir)
  rmSync(testRoot, { recursive: true, force: true })
})

const PACK_ID = 'nature-research'
const SKILL_NAMES = [
  'paper-deep-reading',
  'figure-standards',
  'literature-review-outline',
  'reviewer-self-check',
  'scientific-figure-style',
]

describe('research skill pack assets and registry', () => {
  it('ships every registered skill folder with a SKILL.md whose name matches', async () => {
    expect(await service.listShippedSkillAssetNames()).toEqual([...SKILL_NAMES].sort())
    const pack = service.getResearchSkillPack(PACK_ID)
    expect(pack).toBeTruthy()
    expect(pack!.skills.map(skill => skill.name)).toEqual(SKILL_NAMES)
    expect(service.findMissingSkillAssets(pack!)).toEqual([])
    for (const name of SKILL_NAMES) {
      const content = readFileSync(join(ASSETS_DIR, name, 'SKILL.md'), 'utf8')
      expect(content).toMatch(new RegExp(`^---\\nname: ${name}\\n`, 'm'))
      expect(content).toMatch(/description: "/)
      // Body must have prose beyond the frontmatter.
      expect(content.split('---').pop()!.trim().length).toBeGreaterThan(100)
    }
  })
})

describe('research skill pack HTTP surface', () => {
  it('keeps the health route working', async () => {
    const ctx = await dispatch('GET', '/api/studio/research/skillpacks/health')
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ ok: true, subdomain: 'skillpacks' })
  })

  it('lists the pack with all skills missing before the first load', async () => {
    const ctx = await dispatch('GET', '/api/studio/research/skillpacks')
    expect(ctx.status).toBe(200)
    expect(ctx.body.packs).toHaveLength(1)
    const pack = ctx.body.packs[0]
    expect(pack).toMatchObject({ id: PACK_ID, target: 'hermes', loaded: false })
    expect(pack.targetDir).toBe(join(hermesRoot, 'skills'))
    expect(pack.skills.map((skill: any) => skill.status)).toEqual(Array(5).fill('missing'))
    expect(ctx.body.assetProblems).toEqual([])
  })

  it('404s for unknown pack ids on every route', async () => {
    expect((await dispatch('GET', '/api/studio/research/skillpacks/nope')).status).toBe(404)
    expect((await dispatch('POST', '/api/studio/research/skillpacks/nope/load', {})).status).toBe(404)
    expect((await dispatch('POST', '/api/studio/research/skillpacks/nope/unload', {})).status).toBe(404)
  })

  it('rejects unknown profiles on every route and in the service facade', async () => {
    // The profile option resolves to a real directory on disk, so it must be a
    // known profile — an arbitrary string must never be applied.
    const badList = await dispatch('GET', '/api/studio/research/skillpacks', undefined, { profile: 'nope' })
    expect(badList.status).toBe(400)
    expect(badList.body.error).toContain('unknown profile "nope"')

    const badGet = await dispatch('GET', `/api/studio/research/skillpacks/${PACK_ID}`, undefined, { profile: 'nope' })
    expect(badGet.status).toBe(400)
    expect(badGet.body.error).toContain('known profiles')

    const badLoad = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, { profile: 'nope' })
    expect(badLoad.status).toBe(400)
    expect(badLoad.body.error).toContain('unknown profile "nope"')

    const badUnload = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/unload`, { profile: 'nope' })
    expect(badUnload.status).toBe(400)

    await expect(service.loadSkillPack(PACK_ID, { profile: 'nope' })).rejects.toThrow(/unknown profile "nope"/)
    await expect(service.unloadSkillPack(PACK_ID, { profile: 'nope' })).rejects.toThrow(/unknown profile "nope"/)
  })

  it('loads every skill into the profile skills dir and reports the installed status', async () => {
    const ctx = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, {})
    expect(ctx.status).toBe(200)
    expect(ctx.body.result.installed).toEqual(SKILL_NAMES)
    expect(ctx.body.result.updated).toEqual([])
    expect(ctx.body.result.skipped).toEqual([])
    expect(ctx.body.pack.loaded).toBe(true)
    for (const name of SKILL_NAMES) {
      const installedPath = join(hermesRoot, 'skills', name, 'SKILL.md')
      expect(existsSync(installedPath), installedPath).toBe(true)
      expect(readFileSync(installedPath, 'utf8')).toBe(readFileSync(join(ASSETS_DIR, name, 'SKILL.md'), 'utf8'))
    }
    const manifest = JSON.parse(readFileSync(join(hermesRoot, 'skills', '.research-skillpacks.json'), 'utf8'))
    expect(Object.keys(manifest.skills).sort()).toEqual([...SKILL_NAMES].sort())
    for (const name of SKILL_NAMES) {
      expect(manifest.skills[name]).toMatchObject({ pack: PACK_ID })
    }
  })

  it('skips unchanged skills on reload and restores force-reloaded modifications', async () => {
    const upToDate = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, {})
    expect(upToDate.body.result.installed).toEqual([])
    expect(upToDate.body.result.updated).toEqual([])
    expect(upToDate.body.result.skipped.map((entry: any) => entry.action)).toEqual(Array(5).fill('skipped'))

    // User edits an installed skill: status flips to modified, plain reload
    // refuses to clobber, force reload restores the shipped copy.
    const modifiedSkill = join(hermesRoot, 'skills', 'figure-standards', 'SKILL.md')
    writeFileSync(modifiedSkill, readFileSync(modifiedSkill, 'utf8') + '\nUser local edit.\n', 'utf8')
    const status = await dispatch('GET', `/api/studio/research/skillpacks/${PACK_ID}`)
    const figureStandards = status.body.pack.skills.find((skill: any) => skill.name === 'figure-standards')
    expect(figureStandards.status).toBe('modified')
    expect(figureStandards.managed).toBe(true)

    const plainReload = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, {})
    expect(plainReload.body.result.installed).toEqual([])
    expect(plainReload.body.result.skipped.find((entry: any) => entry.name === 'figure-standards').detail).toContain('force:true')

    const forcedReload = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, { force: true })
    expect(forcedReload.body.result.updated).toEqual(['figure-standards'])
    expect(readFileSync(modifiedSkill, 'utf8')).toBe(readFileSync(join(ASSETS_DIR, 'figure-standards', 'SKILL.md'), 'utf8'))
    const restored = await dispatch('GET', `/api/studio/research/skillpacks/${PACK_ID}`)
    expect(restored.body.pack.skills.every((skill: any) => skill.status === 'installed')).toBe(true)
  })

  it('keeps guarding a modified installed copy when the pack source moved on too', async () => {
    // Combined-state regression: the installed copy carries a user edit AND
    // the manifest records a stale source hash (the pack source changed since
    // install). This is exactly the state the status surface reports as
    // "modified", so a plain load must refuse to clobber instead of silently
    // overwriting. The stale hash is written into the test-owned manifest
    // rather than mutating the shipped assets, keeping parallel test files
    // that read the assets deterministic.
    const manifestPath = join(hermesRoot, 'skills', '.research-skillpacks.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.skills['figure-standards'] = { ...manifest.skills['figure-standards'], sourceHash: '0'.repeat(64) }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const modifiedSkill = join(hermesRoot, 'skills', 'figure-standards', 'SKILL.md')
    writeFileSync(modifiedSkill, readFileSync(modifiedSkill, 'utf8') + '\nUser edit survives source upgrades.\n', 'utf8')

    const status = await dispatch('GET', `/api/studio/research/skillpacks/${PACK_ID}`)
    const figureStandards = status.body.pack.skills.find((skill: any) => skill.name === 'figure-standards')
    expect(figureStandards.status).toBe('modified')

    const plainReload = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, {})
    expect(plainReload.body.result.installed).toEqual([])
    expect(plainReload.body.result.updated).toEqual([])
    const guarded = plainReload.body.result.skipped.find((entry: any) => entry.name === 'figure-standards')
    expect(guarded.action).toBe('skipped')
    expect(guarded.detail).toContain('force:true')
    expect(readFileSync(modifiedSkill, 'utf8')).toContain('User edit survives source upgrades.')

    const forcedReload = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, { force: true })
    expect(forcedReload.body.result.updated).toEqual(['figure-standards'])
    expect(readFileSync(modifiedSkill, 'utf8')).toBe(readFileSync(join(ASSETS_DIR, 'figure-standards', 'SKILL.md'), 'utf8'))
    const restoredStatus = await dispatch('GET', `/api/studio/research/skillpacks/${PACK_ID}`)
    expect(restoredStatus.body.pack.skills.every((skill: any) => skill.status === 'installed')).toBe(true)
  })

  it('never overwrites an unmanaged colliding skill folder', async () => {
    // A second isolated profile root keeps this scenario independent of the
    // already-loaded default profile.
    const conflictRoot = join(testRoot, 'conflict-root')
    mkdirSync(join(conflictRoot, 'skills', 'figure-standards'), { recursive: true })
    const foreignFile = join(conflictRoot, 'skills', 'figure-standards', 'SKILL.md')
    writeFileSync(foreignFile, '---\nname: figure-standards\ndescription: "user copy"\n---\n\nUser made their own skill.\n', 'utf8')
    process.env.HERMES_HOME = conflictRoot
    try {
      const loaded = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, {})
      expect(loaded.body.result.installed).toEqual(SKILL_NAMES.filter(name => name !== 'figure-standards'))
      const conflict = loaded.body.result.skipped.find((entry: any) => entry.name === 'figure-standards')
      expect(conflict.action).toBe('skipped')
      expect(conflict.detail).toContain('not research-skillpack managed')
      expect(readFileSync(foreignFile, 'utf8')).toContain('user copy')
      // Unloading must not remove the user's own folder either.
      const unloaded = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/unload`, {})
      expect(unloaded.body.result.removed).toEqual(SKILL_NAMES.filter(name => name !== 'figure-standards'))
      expect(existsSync(foreignFile)).toBe(true)
    } finally {
      process.env.HERMES_HOME = hermesRoot
    }
  })

  it('unloads managed skills and reports modified copies without force', async () => {
    const tampered = join(hermesRoot, 'skills', 'reviewer-self-check', 'SKILL.md')
    writeFileSync(tampered, readFileSync(tampered, 'utf8') + '\nLocal change.\n', 'utf8')

    const guarded = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/unload`, {})
    expect(guarded.body.result.removed).toEqual(SKILL_NAMES.filter(name => name !== 'reviewer-self-check'))
    expect(existsSync(tampered)).toBe(true)
    const skipped = guarded.body.result.skipped.find((entry: any) => entry.name === 'reviewer-self-check')
    expect(skipped.action).toBe('skipped')
    expect(skipped.detail).toContain('force:true')

    const forced = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/unload`, { force: true })
    expect(forced.body.result.removed).toEqual(['reviewer-self-check'])
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(hermesRoot, 'skills', name))).toBe(false)
    }
    const manifest = JSON.parse(readFileSync(join(hermesRoot, 'skills', '.research-skillpacks.json'), 'utf8'))
    expect(manifest.skills).toEqual({})
    const status = await dispatch('GET', `/api/studio/research/skillpacks/${PACK_ID}`)
    expect(status.body.pack.skills.map((skill: any) => skill.status)).toEqual(Array(5).fill('missing'))
  })

  it('resolves the Claude family target to ~/.claude/skills without touching it', async () => {
    expect(service.resolveSkillPackTargetDir('claude', 'default')).toContain(join('.claude', 'skills'))
  })
})

describe('loaded skills surface through the Agent-side channels', () => {
  it('loads the pack fresh for the enumeration assertions', async () => {
    const ctx = await dispatch('POST', `/api/studio/research/skillpacks/${PACK_ID}/load`, {})
    expect(ctx.body.result.installed).toEqual(SKILL_NAMES)
  })

  it('lists loaded research skills in the Hermes skill enumeration (GET /api/hermes/skills scan)', async () => {
    const controller = await import(HERMES_SKILLS_CONTROLLER)
    const ctx: any = { query: {}, params: {}, state: {}, body: undefined }
    await controller.list(ctx)
    expect(ctx.body.paths.local).toBe(join(hermesRoot, 'skills'))
    const categories = ctx.body.categories as Array<{ name: string; skills: Array<{ name: string; source: string; description: string }> }>
    const listed = categories.flatMap(category => category.skills.map(skill => ({ ...skill, category: category.name })))
    for (const name of SKILL_NAMES) {
      const skill = listed.find(candidate => candidate.name === name)
      expect(skill, `${name} must appear in the agent skill enumeration`).toBeTruthy()
      expect(skill!.category).toBe('misc')
      expect(skill!.source).toBe('local')
      expect(skill!.description.length).toBeGreaterThan(0)
    }
  })

  it('resolves loaded skills through the workflow runtime skill binding', async () => {
    const { resolveWorkflowSkillContent } = await import(SKILL_RESOLVER)
    const resolved = await resolveWorkflowSkillContent({ profile: 'default', skillName: 'scientific-figure-style' })
    expect(resolved).toBeTruthy()
    expect(resolved!.path).toBe(join(hermesRoot, 'skills', 'scientific-figure-style', 'SKILL.md'))
    expect(resolved!.content).toContain('绘制→检查→修正')
    expect(resolved!.content).toContain('svg')

    const missing = await resolveWorkflowSkillContent({ profile: 'default', skillName: 'not-a-research-skill' })
    expect(missing).toBeNull()
  })
})
