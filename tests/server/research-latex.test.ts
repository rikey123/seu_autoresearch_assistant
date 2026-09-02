import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES_MODULE = '../../packages/server/src/modules/research/latex/index'
const STORE_MODULE = '../../packages/server/src/modules/research/latex/latex-store'
const TECTONIC_MODULE = '../../packages/server/src/modules/research/latex/tectonic'
const TEMPLATE_MODULE = '../../packages/server/src/modules/research/latex/template'
const TEMPLATE_FILE = resolve(__dirname, '../../packages/server/src/modules/research/latex/templates/default-paper.tex')
const ARTIFACTS_STORE_MODULE = '../../packages/server/src/modules/research/artifacts/artifact-store'

type LatexRoutes = typeof import('../../packages/server/src/modules/research/latex/index')
type LatexStore = typeof import('../../packages/server/src/modules/research/latex/latex-store')
type TectonicModule = typeof import('../../packages/server/src/modules/research/latex/tectonic')
type TemplateModule = typeof import('../../packages/server/src/modules/research/latex/template')
type ArtifactsStore = typeof import('../../packages/server/src/modules/research/artifacts/artifact-store')

interface SpawnCall {
  command: string
  args: string[]
  options: Record<string, unknown>
}

const testState = vi.hoisted(() => {
  class TestEmitter {
    private readonly handlers = new Map<string, Array<(...args: any[]) => void>>()

    on(event: string, handler: (...args: any[]) => void) {
      const list = this.handlers.get(event) || []
      list.push(handler)
      this.handlers.set(event, list)
      return this
    }

    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) || []) handler(...args)
      return true
    }
  }

  return {
    spawnCalls: [] as SpawnCall[],
    // Behavior hook: (call, child) => void. Tests emit child events (and
    // optionally write an output PDF) to simulate the tectonic process.
    behavior: null as null | ((call: SpawnCall, child: any) => void),
    TestEmitter,
  }
})

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    const child = new testState.TestEmitter() as any
    child.stdout = new testState.TestEmitter()
    child.stderr = new testState.TestEmitter()
    child.kill = vi.fn()
    const call = { command, args, options }
    testState.spawnCalls.push(call)
    testState.behavior?.(call, child)
    return child
  },
}))

const MOCK_PDF_BYTES = Buffer.from('%PDF-1.4 mock compilation\n')

// Simulates a tectonic run that succeeds and writes document.pdf next to the
// input file inside the requested --outdir.
function succeedAfterWritingPdf(call: SpawnCall, child: any): void {
  queueMicrotask(() => {
    try {
      const outDir = call.args[call.args.indexOf('--outdir') + 1]
      writeFileSync(join(outDir, 'document.pdf'), MOCK_PDF_BYTES)
      child.stdout.emit('data', Buffer.from('Running TeX ...\n'))
      child.emit('close', 0)
    } catch {
      child.emit('close', 1)
    }
  })
}

let home = ''
let routes: LatexRoutes
let store: LatexStore
let tectonic: TectonicModule
let template: TemplateModule
let artifactsStore: ArtifactsStore
let originalTectonicBin: string | undefined
let originalPath: string | undefined
let fakeBinPath = ''

async function dispatch(method: string, path: string, overrides: Record<string, unknown> = {}) {
  const dispatchRoute = routes.latexRoutes.routes()
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

async function createDoc(overrides: Record<string, unknown> = {}) {
  return dispatch('POST', '/api/studio/research/latex/documents', {
    request: { body: { title: 'Intro paper', source: 'mock source', ...overrides } },
  })
}

async function waitFor(fn: () => boolean, label: string) {
  await vi.waitFor(() => {
    if (!fn()) throw new Error(`condition not met: ${label}`)
  })
}

beforeEach(async () => {
  vi.resetModules()
  testState.spawnCalls.length = 0
  testState.behavior = succeedAfterWritingPdf
  originalTectonicBin = process.env.TECTONIC_BIN
  originalPath = process.env.PATH
  delete process.env.TECTONIC_BIN
  home = mkdtempSync(join(tmpdir(), 'research-latex-'))
  process.env.HERMES_WEB_UI_HOME = home
  fakeBinPath = join(home, 'fake-tectonic')
  writeFileSync(fakeBinPath, '#!/bin/sh\nexit 0\n')
  store = await import(STORE_MODULE)
  tectonic = await import(TECTONIC_MODULE)
  template = await import(TEMPLATE_MODULE)
  artifactsStore = await import(ARTIFACTS_STORE_MODULE)
  routes = await import(ROUTES_MODULE)
})

afterEach(() => {
  store.closeLatexDb()
  artifactsStore.closeArtifactsDb()
  if (originalTectonicBin === undefined) delete process.env.TECTONIC_BIN
  else process.env.TECTONIC_BIN = originalTectonicBin
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  delete process.env.HERMES_WEB_UI_HOME
  testState.behavior = null
  rmSync(home, { recursive: true, force: true })
  home = ''
})

describe('latex document store', () => {
  it('creates both latex tables with the expected columns', () => {
    const db = store.getLatexDb()
    const columnsOf = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name)

    expect(columnsOf('latex_documents')).toEqual([
      'id', 'title', 'source', 'project_id', 'created_at', 'updated_at',
    ])
    expect(columnsOf('latex_compilations')).toEqual([
      'id', 'document_id', 'status', 'engine', 'exit_code', 'artifact_id',
      'errors_json', 'log', 'created_at', 'updated_at', 'started_at', 'finished_at',
    ])
  })

  it('persists document updates and deletions', () => {
    const created = store.createDocument({ title: 'Draft', source: 'a' })
    const updated = store.updateDocument(created.id, { source: 'b', title: 'Draft v2' })
    expect(updated).toMatchObject({ title: 'Draft v2', source: 'b' })

    expect(store.getDocument(created.id)?.updated_at).toBe(updated?.updated_at)
    expect(store.deleteDocument(created.id)).toBe(true)
    expect(store.getDocument(created.id)).toBeNull()
    expect(store.deleteDocument(created.id)).toBe(false)
  })

  it('reconciles queued and running compilations to failed when the database reopens', () => {
    const doc = store.createDocument({ title: 'Reconcile', source: 'x' })
    const queued = store.createCompilation({ document_id: doc.id })
    const running = store.createCompilation({ document_id: doc.id })
    store.updateCompilation(running.id, { status: 'running', started_at: Date.now() })
    // Pre-existing diagnostics survive the reconciliation (COALESCE-style
    // branch: non-empty errors_json is kept).
    store.updateCompilation(queued.id, { errors: [{ file: 'pre.tex', line: 1, message: 'pre-existing' }] })

    // A fresh process opens the DB: non-final rows are leftovers and must be
    // moved to failed with an explicit interrupted error (same rule as
    // rag-store/translation-queue-store), so the old 30-minute freshness
    // window is no longer the only recovery path.
    store.closeLatexDb()
    const reopened = store.getLatexDb()
    expect(reopened).toBeTruthy()

    const queuedAfter = store.getCompilation(queued.id)
    expect(queuedAfter?.status).toBe('failed')
    expect(queuedAfter?.errors).toEqual([{ file: 'pre.tex', line: 1, message: 'pre-existing' }])
    expect(queuedAfter?.finished_at).toBeGreaterThan(0)

    const runningAfter = store.getCompilation(running.id)
    expect(runningAfter?.status).toBe('failed')
    expect(runningAfter?.errors).toEqual([{
      file: '',
      line: null,
      message: 'interrupted: server restarted while the compilation was running',
    }])
    expect(runningAfter?.started_at).toBeGreaterThan(0)
    expect(runningAfter?.finished_at).toBeGreaterThan(0)

    // A compilation queued after the reopen is untouched.
    const fresh = store.createCompilation({ document_id: doc.id })
    expect(fresh.status).toBe('queued')
  })
})

describe('tectonic adapter', () => {
  it('prefers TECTONIC_BIN and reports null when nothing resolves', () => {
    process.env.TECTONIC_BIN = fakeBinPath
    expect(tectonic.resolveTectonicBin()).toEqual({ bin: fakeBinPath, source: 'env' })

    process.env.TECTONIC_BIN = join(home, 'missing-tectonic')
    expect(tectonic.resolveTectonicBin()).toBeNull()

    delete process.env.TECTONIC_BIN
    process.env.PATH = ''
    expect(tectonic.resolveTectonicBin()).toBeNull()
  })

  it('parses file:line:message summaries from stderr', () => {
    const stderr = [
      'Running TeX ...',
      './main.tex:12: Undefined control sequence.',
      './chapters/intro.tex:3: LaTeX Error: Environment figure undefined.',
    ].join('\n')
    expect(tectonic.parseTectonicErrors(stderr)).toEqual([
      { file: './main.tex', line: 12, message: 'Undefined control sequence.' },
      { file: './chapters/intro.tex', line: 3, message: 'LaTeX Error: Environment figure undefined.' },
    ])
  })

  it('parses severity-prefixed file:line:message summaries from stderr', () => {
    // Real tectonic stderr prefixes rustc-style summary lines with a severity
    // word ("error:" is the common shape seen in engine transcripts).
    const stderr = [
      'Running TeX ...',
      'error: bad2.tex:3: unexpected token',
      'warning: ./chapters/intro.tex:5: undefined reference',
      'note: ./main.tex:12: font shape undefined',
      'error: The TeX compiler exited with bad status.',
    ].join('\n')
    expect(tectonic.parseTectonicErrors(stderr)).toEqual([
      { file: 'bad2.tex', line: 3, message: 'unexpected token' },
      { file: './chapters/intro.tex', line: 5, message: 'undefined reference' },
      { file: './main.tex', line: 12, message: 'font shape undefined' },
      { file: '', line: null, message: 'The TeX compiler exited with bad status.' },
    ])
  })

  it('parses classic TeX transcripts with ! messages, l.N lines, and (./file.tex tokens', () => {
    const stderr = [
      'Running TeX ...',
      '(./main.tex',
      '! Undefined control sequence.',
      'l.7 \\brokenmacro',
      '',
      '(./other.tex',
      '! Missing $ inserted.',
      'l.12 x _ y',
    ].join('\n')
    expect(tectonic.parseTectonicErrors(stderr)).toEqual([
      { file: './main.tex', line: 7, message: 'Undefined control sequence.' },
      { file: './other.tex', line: 12, message: 'Missing $ inserted.' },
    ])
  })

  it('keeps unlocated error lines and rustc-style --> locations', () => {
    const stderr = [
      'error: failed to launch tectonic: ENOENT',
    ].join('\n')
    expect(tectonic.parseTectonicErrors(stderr)).toEqual([
      { file: '', line: null, message: 'failed to launch tectonic: ENOENT' },
    ])

    const arrowed = [
      'error: Undefined control sequence',
      '  --> ./main.tex:15:1',
    ].join('\n')
    expect(tectonic.parseTectonicErrors(arrowed)).toEqual([
      { file: './main.tex', line: 15, message: 'Undefined control sequence' },
    ])
  })

  it('terminates a hung compile at the configured timeout and kills the process tree', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    process.env.HERMES_LATEX_COMPILE_TIMEOUT_MS = '80'
    const heldChildren: any[] = []
    testState.behavior = (_call, child) => {
      heldChildren.push(child)
      // A killed process eventually reports close; simulate that here so the
      // queue settles like it would around a real terminated engine.
      child.kill.mockImplementation(() => queueMicrotask(() => child.emit('close', null)))
    }

    try {
      const created = await createDoc()
      const id = created.body.document.id
      await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
      await waitFor(() => testState.spawnCalls.length === 1, 'tectonic started')

      await waitFor(() => store.latestCompilationForDocument(id)?.status === 'failed', 'timeout reached')

      const latest = store.latestCompilationForDocument(id)
      expect(latest?.exit_code).toBeNull()
      expect(latest?.errors).toEqual([
        { file: '', line: null, message: expect.stringContaining('terminated after 80ms') },
      ])
      expect(latest?.log).toContain('tectonic was terminated after 80ms')
      // The BC-5 lifecycle rule: kill the whole tree, never just the direct child.
      expect(heldChildren[0].kill).toHaveBeenCalled()
    } finally {
      delete process.env.HERMES_LATEX_COMPILE_TIMEOUT_MS
    }
  })

  it('preserves multi-byte UTF-8 output split across data chunks', async () => {
    // stdout/stderr must be accumulated as Buffers and decoded once at the
    // end; per-chunk toString() replaces the split byte of a UTF-8 sequence
    // with U+FFFD (LaTeX comments with Chinese text are the common case).
    const child = new testState.TestEmitter() as any
    child.stdout = new testState.TestEmitter()
    child.stderr = new testState.TestEmitter()
    child.kill = vi.fn()
    const spawnImpl = vi.fn(() => child) as any

    const run = tectonic.runTectonic({
      bin: 'tectonic',
      inputPath: join(home, 'document.tex'),
      outDir: join(home, 'builds'),
      spawnImpl,
    })
    // '编译错误：第一处' is 9 three-byte CJK/punctuation characters; the split
    // lands inside the full-width colon sequence (0xEF | 0xBC 0x9A).
    const stdoutBytes = Buffer.from('编译错误：第一处', 'utf8')
    const split = Math.floor(stdoutBytes.length / 2)
    child.stdout.emit('data', stdoutBytes.subarray(0, split))
    child.stdout.emit('data', stdoutBytes.subarray(split))
    child.stderr.emit('data', Buffer.from('error: 第'))
    child.stderr.emit('data', Buffer.from('二处错误'))
    child.emit('close', 1)

    const result = await run
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(result.stdout).toBe('编译错误：第一处')
    expect(result.stdout).not.toContain('\uFFFD')
    expect(result.stderr).toBe('error: 第二处错误')
    expect(result.stderr).not.toContain('\uFFFD')
  })

  it('always spawns through an argument array with shell disabled', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    const created = await createDoc({ source: '\\documentclass{article}' })
    const id = created.body.document.id
    await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
    await waitFor(() => {
      const latest = store.latestCompilationForDocument(id)
      return latest?.status === 'completed'
    }, 'compilation completed')

    expect(testState.spawnCalls).toHaveLength(1)
    const call = testState.spawnCalls[0]
    expect(call.command).toBe(fakeBinPath)
    expect(call.options.shell).toBe(false)
    expect(call.options.windowsHide).toBe(true)
    expect(call.args[0]).toBe('--outdir')
    const outDir = call.args[1]
    const inputPath = call.args[2]
    expect(call.args).toHaveLength(3)
    expect(inputPath).toBe(join(outDir, 'document.tex'))
    expect(readFileSync(inputPath, 'utf8')).toBe('\\documentclass{article}')
  })
})

describe('template paper', () => {
  it('keeps the shipped default-paper.tex in sync with the served template', () => {
    expect(existsSync(TEMPLATE_FILE)).toBe(true)
    expect(template.defaultPaperSource()).toBe(readFileSync(TEMPLATE_FILE, 'utf8'))
  })

  it('seeds documents created without a source and compiles the template to a PDF', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    const created = await dispatch('POST', '/api/studio/research/latex/documents', {
      request: { body: { title: 'Template paper' } },
    })
    expect(created.status).toBe(201)
    expect(created.body.document.source).toBe(template.defaultPaperSource())
    expect(created.body.document.source).toContain('\\documentclass{article}')

    const id = created.body.document.id
    await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
    await waitFor(() => store.latestCompilationForDocument(id)?.status === 'completed', 'template compiled')

    const latest = store.latestCompilationForDocument(id)
    expect(latest?.exit_code).toBe(0)
    expect(latest?.artifact_id).toBeTruthy()
    const pdfPath = join(store.latexBuildsDir(), latest!.id, 'document.pdf')
    expect(readFileSync(pdfPath)).toEqual(MOCK_PDF_BYTES)
  })
})

describe('latex http surface', () => {
  it('performs document CRUD through the API and validates payloads', async () => {
    const created = await createDoc({ project_id: 'proj-1' })
    expect(created.status).toBe(201)
    expect(created.body.document).toMatchObject({
      title: 'Intro paper',
      source: 'mock source',
      project_id: 'proj-1',
    })

    const listed = await dispatch('GET', '/api/studio/research/latex/documents')
    expect(listed.status).toBe(200)
    expect(listed.body.documents).toHaveLength(1)

    const id = created.body.document.id
    const patched = await dispatch('PATCH', `/api/studio/research/latex/documents/${id}`, {
      request: { body: { title: 'Renamed', source: 'new source' } },
    })
    expect(patched.status).toBe(200)
    expect(patched.body.document).toMatchObject({ title: 'Renamed', source: 'new source' })

    const fetched = await dispatch('GET', `/api/studio/research/latex/documents/${id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.document.source).toBe('new source')

    const removed = await dispatch('DELETE', `/api/studio/research/latex/documents/${id}`)
    expect(removed.status).toBe(200)
    expect(store.getDocument(id)).toBeNull()

    const missing = await dispatch('GET', `/api/studio/research/latex/documents/${id}`)
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('latex document not found')

    const noTitle = await createDoc({ title: '   ' })
    expect(noTitle.status).toBe(400)
    expect(noTitle.body).toEqual({ error: 'title is required', code: 'invalid_request' })
  })

  it('answers 503 with a clear code when no tectonic binary resolves', async () => {
    process.env.PATH = ''
    const created = await createDoc()
    const id = created.body.document.id

    const compile = await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
    expect(compile.status).toBe(503)
    expect(compile.body.code).toBe('engine_unavailable')
    expect(compile.body.error).toContain('TECTONIC_BIN')

    const engine = await dispatch('GET', '/api/studio/research/latex/engine')
    expect(engine.body.engine).toEqual({ available: false, source: null, bin: null })
    expect(testState.spawnCalls).toHaveLength(0)
  })

  it('reports the resolved engine through GET /engine', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    const engine = await dispatch('GET', '/api/studio/research/latex/engine')
    expect(engine.body.engine).toEqual({ available: true, source: 'env', bin: fakeBinPath })
  })

  it('compiles asynchronously, registers the PDF artifact, and serves the bytes', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    const created = await createDoc({ title: 'Smoke paper' })
    const id = created.body.document.id

    const compile = await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
    expect(compile.status).toBe(202)
    const compilationId = compile.body.compilation.id
    expect(compile.body.compilation.status).toBe('queued')

    await waitFor(() => store.getCompilation(compilationId)?.status === 'completed', 'compilation completed')

    const latest = await dispatch('GET', `/api/studio/research/latex/documents/${id}/compilations/latest`)
    expect(latest.status).toBe(200)
    expect(latest.body.compilation).toMatchObject({
      id: compilationId,
      status: 'completed',
      exit_code: 0,
    })
    expect(latest.body.compilation.artifact_id).toBeTruthy()

    const pdf = await dispatch('GET', `/api/studio/research/latex/compilations/${compilationId}/pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.type).toBe('application/pdf')
    expect(existsSync(pdf.body.path)).toBe(true)
    expect(readFileSync(pdf.body.path)).toEqual(MOCK_PDF_BYTES)
    // The dispatch harness never consumes koa stream bodies; attach an error
    // listener so cleanup cannot produce a stray unhandled stream error.
    const pdfStream = pdf.body as import('node:fs').ReadStream
    pdfStream.on('error', () => {})
    pdfStream.destroy()

    const artifacts = artifactsStore.listArtifacts({ type: 'pdf' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      type: 'pdf',
      title: 'Smoke paper (compiled PDF)',
      project_id: null,
    })
    expect(artifacts[0].preview).toMatchObject({ documentId: id, compilationId })
  })

  it('surfaces structured tectonic errors when compilation fails', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    testState.behavior = (_call, child) => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from([
          'Running TeX ...',
          '(./document.tex',
          '! Undefined control sequence.',
          'l.3 \\brokenmacro',
          'error: The TeX compiler exited with bad status.',
        ].join('\n')))
        child.emit('close', 1)
      })
    }
    const created = await createDoc({
      source: '\\documentclass{article}\n\\begin{document}\n\\brokenmacro\n\\end{document}\n',
    })
    const id = created.body.document.id
    await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)

    await waitFor(() => store.latestCompilationForDocument(id)?.status === 'failed', 'compilation failed')

    const latest = store.latestCompilationForDocument(id)
    expect(latest?.exit_code).toBe(1)
    expect(latest?.errors).toEqual([
      { file: './document.tex', line: 3, message: 'Undefined control sequence.' },
      { file: '', line: null, message: 'The TeX compiler exited with bad status.' },
    ])
    expect(latest?.log).toContain('Running TeX')

    const status = await dispatch('GET', `/api/studio/research/latex/compilations/${latest?.id}`)
    expect(status.status).toBe(200)
    expect(status.body.compilation.errors).toEqual(latest?.errors)

    const pdf = await dispatch('GET', `/api/studio/research/latex/compilations/${latest?.id}/pdf`)
    expect(pdf.status).toBe(409)
    expect(pdf.body.code).toBe('compilation_not_completed')
  })

  it('rejects a second compile for a document that is queued or running', async () => {
    process.env.TECTONIC_BIN = fakeBinPath
    const heldChildren: any[] = []
    testState.behavior = (_call, child) => {
      heldChildren.push(child)
    }

    const created = await createDoc()
    const id = created.body.document.id
    const first = await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
    expect(first.status).toBe(202)
    await waitFor(() => testState.spawnCalls.length === 1, 'first tectonic run started')

    const second = await dispatch('POST', `/api/studio/research/latex/documents/${id}/compile`)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('compilation_in_progress')

    // Release the first run so the queue does not leak work past the test.
    const call = testState.spawnCalls[0]
    const outDir = call.args[call.args.indexOf('--outdir') + 1]
    writeFileSync(join(outDir, 'document.pdf'), MOCK_PDF_BYTES)
    heldChildren[0].emit('close', 0)
    await waitFor(() => store.latestCompilationForDocument(id)?.status === 'completed', 'compilation completed')
  })

  it('404s compilation endpoints for unknown ids', async () => {
    const latest = await dispatch('GET', '/api/studio/research/latex/documents/nope/compilations/latest')
    expect(latest.status).toBe(404)

    const status = await dispatch('GET', '/api/studio/research/latex/compilations/nope')
    expect(status.status).toBe(404)
    expect(status.body.error).toBe('latex compilation not found')

    const pdf = await dispatch('GET', '/api/studio/research/latex/compilations/nope/pdf')
    expect(pdf.status).toBe(404)
  })
})
