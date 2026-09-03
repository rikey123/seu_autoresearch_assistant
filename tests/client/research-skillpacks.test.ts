import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client contract for the research skill pack surface: URL shapes, method,
// and payload wrapping must mirror the server controller exactly, because the
// workflows hub drives auto-loading and status display through this client.
const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  request: mockRequest,
}))

import {
  fetchSkillPack,
  listSkillPacks,
  loadSkillPack,
  unloadSkillPack,
  type ResearchSkillPackStatus,
} from '@/api/studio/research-skillpacks'

function packStatus(overrides: Partial<ResearchSkillPackStatus> = {}): ResearchSkillPackStatus {
  return {
    id: 'nature-research',
    name: 'Nature 科研技能精选包',
    description: 'nature-skills 精选子集',
    origin: 'nature-skills (Yuan1z0825) 精选改写',
    target: 'hermes',
    targetDir: '/hermes/skills',
    loaded: false,
    skills: [
      { name: 'literature-review-outline', title: '文献综述提纲', summary: '综述提纲模板', status: 'missing', managed: false, installedPath: null },
      { name: 'scientific-figure-style', title: '科研绘图规范', summary: '绘图→检查→修正循环', status: 'installed', managed: true, installedPath: '/hermes/skills/scientific-figure-style' },
    ],
    ...overrides,
  }
}

describe('research skillpacks api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists pack statuses with the five-state per-skill contract', async () => {
    const packs = [packStatus()]
    mockRequest.mockResolvedValue({ packs, assetProblems: [] })

    const result = await listSkillPacks()

    expect(mockRequest).toHaveBeenCalledWith('/api/studio/research/skillpacks')
    expect(result.packs).toEqual(packs)
    expect(result.packs[0].skills.map(skill => skill.status)).toEqual(['missing', 'installed'])
  })

  it('forwards list/get profile and target options as query parameters', async () => {
    mockRequest.mockResolvedValue({ packs: [], assetProblems: [] })
    mockRequest.mockResolvedValueOnce({ packs: [], assetProblems: [] })
    await listSkillPacks({ profile: 'default', target: 'claude' })
    expect(mockRequest).toHaveBeenCalledWith('/api/studio/research/skillpacks?profile=default&target=claude')

    mockRequest.mockResolvedValue({ pack: null })
    const pack = await fetchSkillPack('nature-research', { profile: 'paper' })
    expect(mockRequest).toHaveBeenCalledWith('/api/studio/research/skillpacks/nature-research?profile=paper')
    expect(pack).toBeNull()
  })

  it('unwraps the load response envelope and posts the options body', async () => {
    const pack = packStatus({ loaded: true })
    const result = {
      pack: 'nature-research',
      target: 'hermes' as const,
      targetDir: '/hermes/skills',
      profile: 'default',
      installed: ['literature-review-outline'],
      updated: [],
      skipped: [],
      results: [{ name: 'literature-review-outline', action: 'installed' as const }],
    }
    mockRequest.mockResolvedValue({ result, pack })

    const loaded = await loadSkillPack('nature-research')

    expect(mockRequest).toHaveBeenCalledWith('/api/studio/research/skillpacks/nature-research/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(loaded.result.installed).toEqual(['literature-review-outline'])
    expect(loaded.pack.loaded).toBe(true)
  })

  it('passes force through the load/unload bodies (the only overwrite path for modified copies)', async () => {
    mockRequest.mockResolvedValue({
      result: { pack: 'nature-research', target: 'hermes', targetDir: '/d', profile: 'default', installed: [], updated: [], skipped: [], results: [] },
      pack: packStatus(),
    })

    await loadSkillPack('nature-research', { force: true })
    expect(mockRequest.mock.calls[0][1].body).toBe(JSON.stringify({ force: true }))

    await unloadSkillPack('nature-research', { force: true })
    expect(mockRequest).toHaveBeenCalledWith('/api/studio/research/skillpacks/nature-research/unload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    })
  })

  it('unwraps the unload response envelope', async () => {
    const pack = packStatus({ loaded: false, skills: [] })
    mockRequest.mockResolvedValue({
      result: { pack: 'nature-research', target: 'hermes', targetDir: '/d', profile: 'default', removed: ['scientific-figure-style'], skipped: [] },
      pack,
    })

    const unloaded = await unloadSkillPack('nature-research')

    expect(mockRequest).toHaveBeenCalledWith('/api/studio/research/skillpacks/nature-research/unload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(unloaded.result.removed).toEqual(['scientific-figure-style'])
  })

  it('propagates transport errors so the hub can fall back to unknown tags', async () => {
    mockRequest.mockRejectedValue(new Error('offline'))
    await expect(listSkillPacks()).rejects.toThrow('offline')
  })
})
