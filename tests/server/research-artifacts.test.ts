import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES_MODULE = '../../packages/server/src/modules/research/artifacts/index'
const STORE_MODULE = '../../packages/server/src/modules/research/artifacts/artifact-store'

type ArtifactsModule = typeof import('../../packages/server/src/modules/research/artifacts/index')
type ArtifactStoreModule = typeof import('../../packages/server/src/modules/research/artifacts/artifact-store')

let home = ''
let routes: ArtifactsModule
let store: ArtifactStoreModule

// Dispatch through the real router middleware so path params and method
// matching behave like an incoming request.
async function dispatch(method: string, path: string, overrides: Record<string, unknown> = {}) {
  const dispatchRoute = routes.artifactsRoutes.routes()
  const ctx: any = {
    method,
    path,
    query: {},
    params: {},
    request: { body: undefined },
    state: {},
    status: 200,
    body: undefined,
    ...overrides,
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

async function postArtifact(body: Record<string, unknown>) {
  return dispatch('POST', '/api/studio/research/artifacts', { request: { body } })
}

describe('research artifacts registry', () => {
  beforeEach(async () => {
    vi.resetModules()
    home = mkdtempSync(join(tmpdir(), 'research-artifacts-'))
    process.env.HERMES_WEB_UI_HOME = home
    store = await import(STORE_MODULE)
    routes = await import(ROUTES_MODULE)
  })

  afterEach(() => {
    store.closeArtifactsDb()
    delete process.env.HERMES_WEB_UI_HOME
    rmSync(home, { recursive: true, force: true })
    home = ''
  })

  it('initializes the artifacts table with registry columns and indexes', () => {
    const db = store.getArtifactsDb()

    const columns = (db.prepare('PRAGMA table_info(artifacts)').all() as Array<{ name: string }>)
      .map(column => column.name)
    expect(columns).toEqual([
      'id', 'project_id', 'type', 'title', 'version', 'source_run_id', 'preview_json', 'created_at', 'updated_at',
    ])

    const indexes = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'artifacts'",
    ).all() as Array<{ name: string }>).map(index => index.name)
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_artifacts_type',
      'idx_artifacts_project',
      'idx_artifacts_source_run',
    ]))
  })

  it('creates an artifact through POST /artifacts', async () => {
    const ctx = await postArtifact({
      type: 'svg',
      title: 'Overview figure',
      project_id: 'proj-1',
      source_run_id: 'run-1',
      preview: { width: 640, height: 480 },
    })

    expect(ctx.status).toBe(201)
    expect(ctx.body.artifact).toMatchObject({
      type: 'svg',
      title: 'Overview figure',
      version: 1,
      project_id: 'proj-1',
      source_run_id: 'run-1',
      preview: { width: 640, height: 480 },
    })
    expect(ctx.body.artifact.id).toBeTruthy()

    expect(store.listArtifacts()).toHaveLength(1)
  })

  it('rejects invalid create payloads', async () => {
    const invalidType = await postArtifact({ type: 'png', title: 'Chart' })
    expect(invalidType.status).toBe(400)
    expect(invalidType.body.error).toContain('type must be one of')

    const missingTitle = await postArtifact({ type: 'html', title: '   ' })
    expect(missingTitle.status).toBe(400)
    expect(missingTitle.body).toEqual({ error: 'title is required' })

    const invalidVersion = await postArtifact({ type: 'html', title: 'Report', version: 0 })
    expect(invalidVersion.status).toBe(400)
    expect(invalidVersion.body).toEqual({ error: 'version must be a positive integer' })

    expect(store.listArtifacts()).toHaveLength(0)
  })

  it('lists artifacts with type filtering through GET /artifacts', async () => {
    await postArtifact({ type: 'svg', title: 'Figure 1' })
    await postArtifact({ type: 'html', title: 'Report' })
    const third = await postArtifact({ type: 'svg', title: 'Figure 2' })

    const all = await dispatch('GET', '/api/studio/research/artifacts')
    expect(all.status).toBe(200)
    expect(all.body.artifacts).toHaveLength(3)
    expect(all.body.artifacts.map((a: any) => a.title)).toContain('Report')

    const svgs = await dispatch('GET', '/api/studio/research/artifacts', { query: { type: 'svg' } })
    expect(svgs.status).toBe(200)
    expect(svgs.body.artifacts).toHaveLength(2)
    expect(svgs.body.artifacts.every((a: any) => a.type === 'svg')).toBe(true)
    expect(svgs.body.artifacts.map((a: any) => a.id)).toContain(third.body.artifact.id)

    const unknownType = await dispatch('GET', '/api/studio/research/artifacts', { query: { type: 'png' } })
    expect(unknownType.status).toBe(400)
  })

  it('returns artifact details through GET /artifacts/:id and 404 for unknown ids', async () => {
    const created = await postArtifact({ type: 'latex', title: 'Paper draft', version: 2 })
    const id = created.body.artifact.id

    const detail = await dispatch('GET', `/api/studio/research/artifacts/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.artifact).toMatchObject({ id, type: 'latex', title: 'Paper draft', version: 2 })

    const missing = await dispatch('GET', '/api/studio/research/artifacts/does-not-exist')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'artifact not found' })
  })

  it('returns preview metadata through GET /artifacts/:id/preview', async () => {
    const created = await postArtifact({
      type: 'drawio',
      title: 'Model diagram',
      preview: { pages: 3, format: 'drawio-xml' },
    })
    const id = created.body.artifact.id

    const preview = await dispatch('GET', `/api/studio/research/artifacts/${id}/preview`)
    expect(preview.status).toBe(200)
    expect(preview.body.preview).toMatchObject({
      id,
      type: 'drawio',
      title: 'Model diagram',
      version: 1,
      source_run_id: null,
      preview: { pages: 3, format: 'drawio-xml' },
    })

    const missing = await dispatch('GET', '/api/studio/research/artifacts/does-not-exist/preview')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'artifact not found' })
  })
})
