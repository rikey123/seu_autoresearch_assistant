import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

// Run-file proxy endpoint: server-proxied streaming of workflow-run PDFs for
// the paper-translate bilingual page. Security-focused coverage: allowed-root
// confinement (workflow run workspaces + appHome/research), traversal and
// symlink escape rejection, Windows drive-letter/case handling, and the
// single-range semantics mirrored from the library paper streaming endpoint.
const originalDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalHome = process.env.HERMES_WEB_UI_HOME
const originalStateDir = process.env.HERMES_WEBUI_STATE_DIR
const originalAuthToken = process.env.AUTH_TOKEN

const testRoot = mkdtempSync(join(tmpdir(), 'research-run-file-proxy-'))
const testDbDir = join(testRoot, 'db')
const testHome = join(testRoot, 'home')
process.env.HERMES_WEB_UI_TEST_DB_DIR = testDbDir
process.env.HERMES_WEB_UI_HOME = testHome
process.env.HERMES_WEBUI_STATE_DIR = testHome
process.env.AUTH_TOKEN = 'run-file-proxy-test-token'

const ROUTES_MODULE = '../../packages/server/src/modules/research/workflows/index'
const WORKFLOW_STORE_MODULE = '../../packages/server/src/modules/studio/repositories/workflow-store'

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%fake minimal pdf for run file proxy tests\n')

type RoutesModule = typeof import('../../packages/server/src/modules/research/workflows/index')
type WorkflowStoreModule = typeof import('../../packages/server/src/modules/studio/repositories/workflow-store')

let routes: RoutesModule
let workflowStore: WorkflowStoreModule

// Dispatch through the real router middleware so method matching and handler
// behavior match an incoming request. `query` is passed pre-parsed: the fake
// ctx hands it to the controller exactly like koa's decoded query object.
async function dispatch(method: string, query: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  const dispatchRoute = routes.workflowsRoutes.routes()
  const ctx: any = {
    method,
    path: '/api/studio/research/run-files',
    query,
    params: {},
    request: { body: undefined },
    state: {},
    status: 200,
    body: undefined,
    headers: {},
    get(name: string) {
      return this.headers[String(name).toLowerCase()] || ''
    },
    set(name: string, value: string) {
      this.headers[String(name).toLowerCase()] = value
    },
    ...overrides,
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

function runFilesQuery(filePath: string): Record<string, string> {
  return { path: filePath }
}

async function drainBody(ctx: any): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of ctx.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Multi-megabyte PDF-shaped payload so range seeks land mid-stream. */
function largePdfBytes(megabytes: number): Buffer {
  const body = Buffer.alloc(megabytes * 1024 * 1024, 0x61)
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), body, Buffer.from('\n%%EOF\n')])
}

interface WorkspaceFixture {
  workspace: string
  workflowId: string
  writePdf: (name: string, data: Buffer) => string
}

function createRunWorkspace(): WorkspaceFixture {
  const workflow = workflowStore.createWorkflow({
    name: 'run-file proxy fixture',
    profile: 'default',
    nodes: [],
    edges: [],
  })
  const workspace = workflow.workspace as string
  expect(workspace).toBeTruthy()
  return {
    workspace,
    workflowId: workflow.id,
    writePdf: (name, data) => {
      const filePath = join(workspace, name)
      writeFileSync(filePath, data)
      return filePath
    },
  }
}

beforeAll(async () => {
  const { initAllStores } = await import('../../packages/server/src/modules/studio/infrastructure/database/init')
  initAllStores()
  workflowStore = await import(WORKFLOW_STORE_MODULE)
  routes = await import(ROUTES_MODULE)
})

afterAll(async () => {
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
  closeDb()
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  restore('HERMES_WEB_UI_TEST_DB_DIR', originalDbDir)
  restore('HERMES_WEB_UI_HOME', originalHome)
  restore('HERMES_WEBUI_STATE_DIR', originalStateDir)
  restore('AUTH_TOKEN', originalAuthToken)
  rmSync(testRoot, { recursive: true, force: true })
})

describe('research run-file proxy', () => {
  it('streams a run-workspace PDF in full and honors the requested byte ranges', async () => {
    const fixture = createRunWorkspace()
    const payload = largePdfBytes(3)
    const pdfPath = fixture.writePdf('translated.pdf', payload)

    const full = await dispatch('GET', runFilesQuery(pdfPath))
    expect(full.status).toBe(200)
    expect(full.headers['accept-ranges']).toBe('bytes')
    expect(full.headers['content-type']).toBe('application/pdf')
    expect(full.headers['content-disposition']).toContain('inline')
    expect(full.headers['content-disposition']).toContain('translated.pdf')
    expect(Number(full.headers['content-length'])).toBe(payload.length)
    expect((await drainBody(full)).equals(payload)).toBe(true)

    // Browsers issue exactly this mid-file range when seeking inside PDFs.
    const middleStart = Math.floor(payload.length / 2)
    const middle = await dispatch('GET', runFilesQuery(pdfPath), {
      headers: { range: `bytes=${middleStart}-${middleStart + 1023}` },
    })
    expect(middle.status).toBe(206)
    expect(middle.headers['content-range']).toBe(`bytes ${middleStart}-${middleStart + 1023}/${payload.length}`)
    expect(Number(middle.headers['content-length'])).toBe(1024)
    expect((await drainBody(middle)).equals(payload.subarray(middleStart, middleStart + 1024))).toBe(true)

    const openEnded = await dispatch('GET', runFilesQuery(pdfPath), {
      headers: { range: `bytes=${payload.length - 3}-` },
    })
    expect(openEnded.status).toBe(206)
    expect((await drainBody(openEnded)).equals(payload.subarray(payload.length - 3))).toBe(true)

    const suffix = await dispatch('GET', runFilesQuery(pdfPath), { headers: { range: 'bytes=-6' } })
    expect(suffix.status).toBe(206)
    expect((await drainBody(suffix)).equals(payload.subarray(payload.length - 6))).toBe(true)

    // End beyond EOF is clamped to the last byte instead of failing.
    const clamped = await dispatch('GET', runFilesQuery(pdfPath), {
      headers: { range: `bytes=${payload.length - 2}-${payload.length + 500}` },
    })
    expect(clamped.status).toBe(206)
    expect(clamped.headers['content-range']).toBe(`bytes ${payload.length - 2}-${payload.length - 1}/${payload.length}`)
    expect((await drainBody(clamped)).equals(payload.subarray(payload.length - 2))).toBe(true)

    const unsatisfiable = await dispatch('GET', runFilesQuery(pdfPath), {
      headers: { range: `bytes=${payload.length + 10}-` },
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${payload.length}`)
    expect(unsatisfiable.body).toBeUndefined()

    // Malformed and multi-range headers fall back to the full 200 response.
    const malformed = await dispatch('GET', runFilesQuery(pdfPath), { headers: { range: 'bytes=abc' } })
    expect(malformed.status).toBe(200)
    expect((await drainBody(malformed)).equals(payload)).toBe(true)

    const multiRange = await dispatch('GET', runFilesQuery(pdfPath), { headers: { range: 'bytes=0-1,4-5' } })
    expect(multiRange.status).toBe(200)
    expect((await drainBody(multiRange)).equals(payload)).toBe(true)
  }, 20000)

  it('answers HEAD with streaming metadata and without opening a read stream', async () => {
    const fixture = createRunWorkspace()
    const pdfPath = fixture.writePdf('head-probe.pdf', MINIMAL_PDF)

    const head = await dispatch('HEAD', runFilesQuery(pdfPath))
    expect(head.status).toBe(200)
    expect(head.headers['accept-ranges']).toBe('bytes')
    expect(head.headers['content-type']).toBe('application/pdf')
    expect(Number(head.headers['content-length'])).toBe(MINIMAL_PDF.length)
    expect(head.body).toBeUndefined()
  })

  it('serves PDFs from the appHome/research root', async () => {
    const researchDir = join(testHome, 'research', 'manual-exports')
    mkdirSync(researchDir, { recursive: true })
    const pdfPath = join(researchDir, 'queued.pdf')
    writeFileSync(pdfPath, MINIMAL_PDF)

    const response = await dispatch('GET', runFilesQuery(pdfPath))
    expect(response.status).toBe(200)
    expect((await drainBody(response)).equals(MINIMAL_PDF)).toBe(true)
  })

  it('rejects traversal, relative, encoded, and out-of-root paths', async () => {
    const fixture = createRunWorkspace()
    fixture.writePdf('inside.pdf', MINIMAL_PDF)

    // Classic ../ escape out of the workspace.
    const traversal = await dispatch('GET', runFilesQuery(join(fixture.workspace, '..', 'outside.pdf')))
    expect(traversal.status).toBe(403)

    // Deep traversal that would resolve back into a legitimate-looking place.
    const deepTraversal = await dispatch('GET', runFilesQuery(join(fixture.workspace, '..', '..', 'etc', 'passwd')))
    expect(deepTraversal.status).toBe(403)

    // Backslash traversal segments (what a percent-encoded %5C payload
    // decodes into on the handler side) are caught by the same lexical check.
    const backslashTraversal = await dispatch('GET', runFilesQuery(fixture.workspace + '\\..\\..\\secret.pdf'))
    expect(backslashTraversal.status).toBe(403)

    // Double-encoded traversal survives decoding as a literal "%2e%2e"
    // segment: it stays lexically inside the root, names a nonexistent file,
    // and must fail closed with 404 (never resolved or followed).
    const doubleEncoded = await dispatch('GET', runFilesQuery(join(fixture.workspace, '%2e%2e', 'secret.pdf')))
    expect(doubleEncoded.status).toBe(404)

    // Relative paths are policy violations.
    const relative = await dispatch('GET', runFilesQuery('paper-translate-out/demo-mono.pdf'))
    expect(relative.status).toBe(403)

    // A real file outside every allowed root is refused even without dots.
    const outsideDir = join(testRoot, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    const outsidePath = join(outsideDir, 'secret.pdf')
    writeFileSync(outsidePath, MINIMAL_PDF)
    const outside = await dispatch('GET', runFilesQuery(outsidePath))
    expect(outside.status).toBe(403)
    expect(outside.body.error).toContain('escapes the allowed research run roots')
  })

  it('rejects symlink escapes from inside an allowed workspace', async () => {
    const fixture = createRunWorkspace()
    const outsideDir = join(testRoot, 'symlink-target')
    mkdirSync(outsideDir, { recursive: true })
    const targetPath = join(outsideDir, 'leak.pdf')
    writeFileSync(targetPath, MINIMAL_PDF)
    const linkPath = join(fixture.workspace, 'innocent.pdf')
    try {
      symlinkSync(targetPath, linkPath)
    } catch {
      // Windows may lack symlink privileges in the test environment; the
      // traversal cases above already exercise the lexical 403 path.
      expect(existsSync(linkPath)).toBe(false)
      return
    }
    const escaped = await dispatch('GET', runFilesQuery(linkPath))
    expect(escaped.status).toBe(403)

    const missingLink = join(fixture.workspace, 'dangling.pdf')
    try {
      symlinkSync(join(outsideDir, 'gone.pdf'), missingLink)
    } catch {
      return
    }
    const dangling = await dispatch('GET', runFilesQuery(missingLink))
    expect(dangling.status).toBe(404)
  })

  it('accepts Windows drive-letter case differences and rejects drive tricks', async () => {
    const fixture = createRunWorkspace()
    const pdfPath = fixture.writePdf('case-probe.pdf', MINIMAL_PDF)
    expect(isAbsolute(pdfPath)).toBe(true)

    if (process.platform === 'win32') {
      const drive = pdfPath.slice(0, 1)
      const lowerCased = drive.toLowerCase() + pdfPath.slice(1)
      const upperCased = drive.toUpperCase() + pdfPath.slice(1)
      for (const candidate of [lowerCased, upperCased]) {
        const response = await dispatch('GET', runFilesQuery(candidate))
        expect(response.status).toBe(200)
        expect((await drainBody(response)).equals(MINIMAL_PDF)).toBe(true)
      }

      // NTFS alternate data stream syntax must never pass the containment
      // check: "file.pdf:hidden" would otherwise look "inside" the root.
      const ads = await dispatch('GET', runFilesQuery(pdfPath + ':hidden'))
      expect(ads.status).toBe(403)
    } else {
      const response = await dispatch('GET', runFilesQuery(pdfPath))
      expect(response.status).toBe(200)
      expect((await drainBody(response)).equals(MINIMAL_PDF)).toBe(true)
    }
  })

  it('404s missing or non-regular targets inside a root and 403s non-PDF files', async () => {
    const fixture = createRunWorkspace()

    const missing = await dispatch('GET', runFilesQuery(join(fixture.workspace, 'ghost-mono.pdf')))
    expect(missing.status).toBe(404)
    expect(missing.body.error).toContain('not found')

    const notesPath = join(fixture.workspace, 'notes.txt')
    writeFileSync(notesPath, 'plain text')
    const notPdf = await dispatch('GET', runFilesQuery(notesPath))
    expect(notPdf.status).toBe(403)
    expect(notPdf.body.error).toContain('.pdf')

    // PDF bytes with a non-PDF extension stay rejected (extension policy).
    const disguisedPath = join(fixture.workspace, 'payload.txt')
    writeFileSync(disguisedPath, MINIMAL_PDF)
    const disguised = await dispatch('GET', runFilesQuery(disguisedPath))
    expect(disguised.status).toBe(403)

    // A directory inside a root is not a regular file.
    const subDir = join(fixture.workspace, 'paper-translate-out')
    mkdirSync(subDir, { recursive: true })
    const directory = await dispatch('GET', runFilesQuery(subDir))
    expect(directory.status).toBe(404)
  })

  it('requires the path query parameter', async () => {
    const missingParam = await dispatch('GET', {})
    expect(missingParam.status).toBe(400)

    const emptyParam = await dispatch('GET', { path: '   ' })
    expect(emptyParam.status).toBe(400)
  })

  it('keeps the workflows health probe untouched', async () => {
    const ctx: any = {
      method: 'GET',
      path: '/api/studio/research/workflows/health',
      query: {},
      params: {},
      request: {},
      state: {},
      status: 200,
      body: undefined,
      headers: {},
      set() {},
    }
    await routes.workflowsRoutes.routes()(ctx, async () => {})
    expect(ctx.body).toEqual({ ok: true, subdomain: 'workflows' })
  })

  // Sanity check on the fixture factory itself: every workflow gets an
  // engine-managed workspace directory (the proxy's primary allowed root).
  it('registers engine run workspaces as allowed roots', () => {
    const fixture = createRunWorkspace()
    expect(existsSync(fixture.workspace)).toBe(true)
  })
})
