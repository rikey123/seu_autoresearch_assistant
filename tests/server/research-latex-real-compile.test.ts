// Optional real-compiler smoke test: runs an actual tectonic build when a
// binary resolves AND HERMES_LATEX_SMOKE=1 is exported. The first real run
// downloads the tectonic bundle, so it stays opt-in to keep CI hermetic.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const SMOKE_ENABLED = process.env.HERMES_LATEX_SMOKE === '1'
const ROUTES_MODULE = '../../packages/server/src/modules/research/latex/index'
const STORE_MODULE = '../../packages/server/src/modules/research/latex/latex-store'
const TECTONIC_MODULE = '../../packages/server/src/modules/research/latex/tectonic'
const TEMPLATE_MODULE = '../../packages/server/src/modules/research/latex/template'

type LatexRoutes = typeof import('../../packages/server/src/modules/research/latex/index')
type LatexStore = typeof import('../../packages/server/src/modules/research/latex/latex-store')
type TectonicModule = typeof import('../../packages/server/src/modules/research/latex/tectonic')
type TemplateModule = typeof import('../../packages/server/src/modules/research/latex/template')

const resolved = SMOKE_ENABLED
  ? (await import(TECTONIC_MODULE)).resolveTectonicBin()
  : null

describe.skipIf(!resolved)('research latex real tectonic smoke', () => {
  let home = ''
  let routes: LatexRoutes
  let store: LatexStore
  let template: TemplateModule

  // The acceptance artifact is the shipped template paper compiled end to end.
  const templatePaper = () => template.defaultPaperSource()

  beforeAll(async () => {
    vi.resetModules()
    home = mkdtempSync(join(tmpdir(), 'research-latex-smoke-'))
    process.env.HERMES_WEB_UI_HOME = home
    store = await import(STORE_MODULE)
    template = await import(TEMPLATE_MODULE)
    routes = await import(ROUTES_MODULE)
    expect(templatePaper()).toContain('\\documentclass{article}')
  })

  afterAll(() => {
    store?.closeLatexDb()
    delete process.env.HERMES_WEB_UI_HOME
    if (home) {
      try {
        rmSync(home, { recursive: true, force: true })
      } catch {
        // Windows can keep the SQLite WAL files locked for a moment right
        // after close; a leftover temp dir is harmless in a smoke test.
      }
    }
    home = ''
  })

  it('compiles the template paper into a real PDF', { timeout: 240_000 }, async () => {
    const dispatchRoute = routes.latexRoutes.routes()
    const dispatch = async (method: string, path: string, body?: unknown) => {
      const ctx: any = {
        method,
        path,
        query: {},
        params: {},
        request: { body },
        state: {},
        status: 200,
        body: undefined,
      }
      await dispatchRoute(ctx, async () => {})
      return ctx
    }

    const created = await dispatch('POST', '/api/studio/research/latex/documents', {
      title: 'Template smoke paper',
      source: templatePaper(),
    })
    expect(created.status).toBe(201)
    const id = created.body.document.id

    const compile = await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`, {})
    expect([202, 409]).toContain(compile.status)

    const compilationId = await vi.waitFor(() => {
      const latest = store.latestCompilationForDocument(id)
      if (!latest || latest.status === 'queued' || latest.status === 'running') {
        throw new Error(`compilation still ${latest?.status ?? 'missing'}`)
      }
      return latest.id
    }, { timeout: 200_000, interval: 2_000 })

    const record = store.getCompilation(compilationId)
    expect(record?.status, record?.log).toBe('completed')

    const pdf = await dispatch('GET', `/api/studio/research/latex/compilations/${compilationId}/pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.type).toBe('application/pdf')
    const head = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      pdf.body.on('data', (chunk: Buffer) => chunks.push(chunk))
      pdf.body.on('end', () => resolve(Buffer.concat(chunks)))
      pdf.body.on('error', reject)
    })
    expect(head.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
