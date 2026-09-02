import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES_MODULE = '../../packages/server/src/modules/research/library/index'
const STORE_MODULE = '../../packages/server/src/modules/research/library/translation-queue-store'
const SERVICE_MODULE = '../../packages/server/src/modules/research/library/translation-queue-service'

type LibraryModule = typeof import('../../packages/server/src/modules/research/library/index')
type StoreModule = typeof import('../../packages/server/src/modules/research/library/translation-queue-store')
type ServiceModule = typeof import('../../packages/server/src/modules/research/library/translation-queue-service')

let home = ''
let workDir = ''
let routes: LibraryModule
let store: StoreModule
let service: ServiceModule

const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
)

function writeStubPdf(name: string): string {
  const pdfPath = join(workDir, name)
  writeFileSync(pdfPath, PDF_BYTES)
  return pdfPath
}

/**
 * A minimal but structurally valid one-page PDF with visible Helvetica text,
 * used only by the gated real-pdf2zh test (the stub only needs the header).
 */
function buildMinimalPdf(text: string): Buffer {
  const contentStream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R '
      + '/Resources <</Font <</F1 5 0 R>>>>>>',
    `<</Length ${contentStream.length}>>\nstream\n${contentStream}\nendstream`,
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function writeStubScript(): string {
  const stubPath = join(workDir, 'pdf2zh-stub.cjs')
  writeFileSync(stubPath, `const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
function argValue(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const mode = process.env.PDF2ZH_STUB_MODE || 'ok';
const input = argValue('-i');
const outDir = argValue('-o');
const service = argValue('-s');
const lang = argValue('-lo');
fs.appendFileSync(path.join(__dirname, 'stub-calls.log'),
  JSON.stringify({ argv: args, cwd: process.cwd(), apiKey: process.env.OPENAI_API_KEY || null, service, lang }) + '\\n');
if (mode === 'fail') {
  process.stderr.write('stub translation failed intentionally\\n');
  process.exit(3);
}
if (mode === 'slow') {
  setTimeout(function () { process.exit(9); }, 60000);
  return;
}
const stem = path.basename(String(input)).replace(/\\.pdf$/i, '');
const payload = '%PDF-1.4\\n%stub-' + mode + '-' + stem + '-service=' + service + '-lang=' + lang + '\\n%EOF\\n';
fs.mkdirSync(String(outDir), { recursive: true });
fs.writeFileSync(path.join(String(outDir), stem + '-mono.pdf'), Buffer.from(payload + '% mono tail padding\\n', 'utf8'));
fs.writeFileSync(path.join(String(outDir), stem + '-dual.pdf'), Buffer.from(payload + '% dual tail padding\\n', 'utf8'));
process.exit(0);
`)
  return stubPath
}

function stubCallsLog(): Array<{ argv: string[]; cwd: string; apiKey: string | null; service: string; lang: string }> {
  const logPath = join(workDir, 'stub-calls.log')
  try {
    return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

async function dispatch(method: string, path: string, overrides: Record<string, unknown> = {}) {
  const headers = (overrides.header as Record<string, string> | undefined) || {}
  const dispatchRoute = routes.libraryRoutes.routes()
  const ctx: any = {
    method,
    path,
    query: {},
    params: {},
    header: headers,
    request: { body: undefined },
    state: {},
    status: 200,
    body: undefined,
    set: (key: string, value: string) => {
      ctx.responseHeaders[key.toLowerCase()] = value
    },
    responseHeaders: {} as Record<string, string>,
    ...overrides,
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

async function postJob(body: Record<string, unknown>) {
  return dispatch('POST', '/api/studio/research/library/translations', { request: { body } })
}

function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

async function waitForJob(id: string, status: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ctx = await dispatch('GET', `/api/studio/research/library/translations/${id}`)
    if (ctx.body?.job?.status === status) return ctx.body.job
    if (ctx.body?.job?.status === 'failed' && status !== 'failed') {
      throw new Error(`job failed while waiting for ${status}: ${ctx.body.job.error}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for job ${id} to reach ${status}; last=${JSON.stringify(ctx.body)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

beforeEach(async () => {
  vi.resetModules()
  home = mkdtempSync(join(tmpdir(), 'research-translate-home-'))
  workDir = mkdtempSync(join(tmpdir(), 'research-translate-work-'))
  process.env.HERMES_WEB_UI_HOME = home
  process.env.OPENAI_API_KEY = 'dummy-key-123'
  process.env.PDF2ZH_STUB_MODE = 'ok'
  delete process.env.PAPER_TRANSLATE_JOB_TIMEOUT_MS
  process.env.PAPER_TRANSLATE_PDF2ZH_BIN = writeStubScript()
  store = await import(STORE_MODULE)
  service = await import(SERVICE_MODULE)
  routes = await import(ROUTES_MODULE)
})

afterEach(async () => {
  service.stopTranslationQueueWorker()
  // Give a just-killed child's close event a beat to settle before removing
  // the temp dirs (Windows keeps deleted-but-open SQLite files locked).
  await new Promise(resolve => setTimeout(resolve, 150))
  store.closeTranslationQueueDb()
  delete process.env.HERMES_WEB_UI_HOME
  delete process.env.OPENAI_API_KEY
  delete process.env.PDF2ZH_STUB_MODE
  delete process.env.PAPER_TRANSLATE_PDF2ZH_BIN
  delete process.env.PAPER_TRANSLATE_JOB_TIMEOUT_MS
  rmSync(home, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
  home = ''
  workDir = ''
})

describe('research translation queue', () => {
  it('validates enqueue payloads (absolute path, existing file, PDF header)', async () => {
    const missingPath = await postJob({})
    expect(missingPath.status).toBe(400)
    expect(missingPath.body.error).toContain('pdfPath is required')

    const relative = await postJob({ pdfPath: 'relative/paper.pdf' })
    expect(relative.status).toBe(400)
    expect(relative.body.error).toContain('absolute path')

    const missingFile = await postJob({ pdfPath: join(workDir, 'nope.pdf') })
    expect(missingFile.status).toBe(404)
    expect(missingFile.body.error).toContain('PDF file not found')

    const notPdf = join(workDir, 'notes.txt')
    writeFileSync(notPdf, 'plain text, not a pdf')
    const badHeader = await postJob({ pdfPath: notPdf })
    expect(badHeader.status).toBe(400)
    expect(badHeader.body.error).toContain('%PDF-')
  })

  it('runs a job end to end through the pdf2zh stub and records products', async () => {
    const pdfPath = writeStubPdf('paper-one.pdf')
    const submitted = await postJob({ pdfPath })
    expect(submitted.status).toBe(202)
    const jobId = submitted.body.job.id
    expect(submitted.body.job.status).toBe('queued')

    const job = await waitForJob(jobId, 'completed')
    expect(job.attempts).toBe(1)
    expect(job.target_lang).toBe('zh')
    expect(job.service).toBe('openai')
    expect(job.out_dir).toBe(join(workDir, 'paper-translate-out'))
    expect(job.mono_path).toBe(join(workDir, 'paper-translate-out', 'paper-one-mono.pdf'))
    expect(job.dual_path).toBe(join(workDir, 'paper-translate-out', 'paper-one-dual.pdf'))

    // The stub keeps the exact T2.2 argv contract: structured argv, no shell.
    // The stub logs process.argv.slice(2) — the pdf2zh-style arguments — and
    // the service ran it via node because the configured bin is a wrapper
    // script.
    const calls = stubCallsLog()
    expect(calls).toHaveLength(1)
    expect(calls[0].argv).toEqual([
      '-i', pdfPath,
      '-o', join(workDir, 'paper-translate-out'),
      '-s', 'openai',
      '-lo', 'zh',
    ])
    // API keys only travel through environment variables.
    expect(calls[0].apiKey).toBe('dummy-key-123')
  })

  it('honors per-job target language, service, and outDir overrides', async () => {
    const pdfPath = writeStubPdf('paper-two.pdf')
    const outDir = join(workDir, 'custom-out')
    const submitted = await postJob({
      pdfPath,
      targetLang: 'ja',
      service: 'openai',
      outDir,
    })
    expect(submitted.status).toBe(202)
    const job = await waitForJob(submitted.body.job.id, 'completed')
    expect(job.target_lang).toBe('ja')
    expect(job.out_dir).toBe(outDir)
    const calls = stubCallsLog()
    expect(calls[0].lang).toBe('ja')
    expect(calls[0].service).toBe('openai')
  })

  it('records failure details for a failing pdf2zh run and retries it', async () => {
    const pdfPath = writeStubPdf('paper-three.pdf')
    process.env.PDF2ZH_STUB_MODE = 'fail'
    const submitted = await postJob({ pdfPath })
    const job = await waitForJob(submitted.body.job.id, 'failed')
    expect(job.attempts).toBe(1)
    expect(job.error).toContain('pdf2zh exited with code 3')
    expect(job.error).toContain('stub translation failed intentionally')
    expect(job.mono_path).toBeNull()
    expect(job.dual_path).toBeNull()

    // Flip the stub back to success BEFORE the retry dispatch: the worker
    // starts synchronously and snapshots the environment at spawn time.
    process.env.PDF2ZH_STUB_MODE = 'ok'
    const retried = await dispatch('POST', `/api/studio/research/library/translations/${job.id}/retry`)
    expect(retried.status).toBe(200)
    expect(retried.body.job.status).toBe('queued')

    const done = await waitForJob(job.id, 'completed')
    expect(done.attempts).toBe(2)
    expect(done.error).toBeNull()
    expect(done.dual_path).toBeTruthy()

    const secondRetry = await dispatch('POST', `/api/studio/research/library/translations/${job.id}/retry`)
    expect(secondRetry.status).toBe(400)
    expect(secondRetry.body.error).toContain('only failed jobs can be retried')
  })

  it('fails fast with a clear error when OPENAI_API_KEY is missing (API-first)', async () => {
    const pdfPath = writeStubPdf('paper-nokey.pdf')
    delete process.env.OPENAI_API_KEY
    const submitted = await postJob({ pdfPath })
    expect(submitted.status).toBe(202)
    const job = await waitForJob(submitted.body.job.id, 'failed')
    expect(job.error).toContain('OPENAI_API_KEY is not configured')
    expect(stubCallsLog()).toHaveLength(0)
  })

  it('times out a stuck pdf2zh child and kills the process tree', async () => {
    const pdfPath = writeStubPdf('paper-stuck.pdf')
    process.env.PDF2ZH_STUB_MODE = 'slow'
    process.env.PAPER_TRANSLATE_JOB_TIMEOUT_MS = '400'
    const submitted = await postJob({ pdfPath })
    const job = await waitForJob(submitted.body.job.id, 'failed', 10000)
    expect(job.error).toContain('timed out after 400ms')
    // The stub child never wrote products: nothing was registered.
    expect(job.mono_path).toBeNull()
    expect(job.dual_path).toBeNull()
  })

  it('processes queued jobs serially in submission order', async () => {
    const first = writeStubPdf('serial-a.pdf')
    const second = writeStubPdf('serial-b.pdf')
    const submittedA = await postJob({ pdfPath: first })
    const submittedB = await postJob({ pdfPath: second })
    const doneA = await waitForJob(submittedA.body.job.id, 'completed')
    const doneB = await waitForJob(submittedB.body.job.id, 'completed')
    expect(doneA.attempts).toBe(1)
    expect(doneB.attempts).toBe(1)
    const calls = stubCallsLog()
    expect(calls).toHaveLength(2)
    expect(calls[0].argv.some(arg => arg.endsWith('serial-a.pdf'))).toBe(true)
    expect(calls[1].argv.some(arg => arg.endsWith('serial-b.pdf'))).toBe(true)
  })

  it('recovers jobs left running by a previous server run as failed', async () => {
    const pdfPath = writeStubPdf('orphan.pdf')
    process.env.PDF2ZH_STUB_MODE = 'slow'
    const enqueued = await postJob({ pdfPath })
    const jobId = enqueued.body.job.id
    // Wait until the worker picked the job up, then close and reopen the
    // queue database: a persisted "running" row cannot survive a restart,
    // so the reopen must mark it failed.
    const deadline = Date.now() + 5000
    while (store.getTranslationJobRow(jobId)?.status !== 'running') {
      if (Date.now() > deadline) throw new Error('job never started running')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    store.closeTranslationQueueDb()
    const reopened = store.getTranslationQueueDb()
    expect(reopened).toBeTruthy()
    const job = store.getTranslationJobRow(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('interrupted')
  })

  it('lists jobs with status filtering through GET /translations', async () => {
    const pdfPath = writeStubPdf('listed.pdf')
    await postJob({ pdfPath })
    await waitForJobAllCompleted()
    const all = await dispatch('GET', '/api/studio/research/library/translations')
    expect(all.status).toBe(200)
    expect(all.body.jobs).toHaveLength(1)
    expect(all.body.jobs[0].status).toBe('completed')
    expect(all.body.jobs[0].files.dual.exists).toBe(true)
    expect(all.body.jobs[0].files.dual.bytes).toBeGreaterThan(0)

    const failed = await dispatch('GET', '/api/studio/research/library/translations', {
      query: { status: 'failed' },
    })
    expect(failed.body.jobs).toHaveLength(0)

    const badFilter = await dispatch('GET', '/api/studio/research/library/translations', {
      query: { status: 'bogus' },
    })
    expect(badFilter.status).toBe(400)
  })

  async function waitForJobAllCompleted() {
    const deadline = Date.now() + 15000
    for (;;) {
      const jobs = store.listTranslationJobs()
      if (jobs.length > 0 && jobs.every(job => job.status === 'completed')) return
      if (Date.now() > deadline) throw new Error('jobs did not complete')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
})

describe('research translation bilingual preview (HTTP Range streaming)', () => {
  it('serves the dual PDF with 200 and full bytes when no Range header is present', async () => {
    const pdfPath = writeStubPdf('range-full.pdf')
    const submitted = await postJob({ pdfPath })
    const job = await waitForJob(submitted.body.job.id, 'completed')
    const dualBytes = readFileSync(job.dual_path)

    const ctx = await dispatch('GET', `/api/studio/research/library/translations/${job.id}/files/dual`)
    expect(ctx.status).toBe(200)
    expect(ctx.responseHeaders['content-type']).toBe('application/pdf')
    expect(ctx.responseHeaders['accept-ranges']).toBe('bytes')
    expect(Number(ctx.responseHeaders['content-length'])).toBe(dualBytes.length)
    const body = await readStream(ctx.body)
    expect(body.equals(dualBytes)).toBe(true)
  })

  it('answers a single byte range with 206 and Content-Range', async () => {
    const pdfPath = writeStubPdf('range-partial.pdf')
    const submitted = await postJob({ pdfPath })
    const job = await waitForJob(submitted.body.job.id, 'completed')
    const dualBytes = readFileSync(job.dual_path)

    const ctx = await dispatch('GET', `/api/studio/research/library/translations/${job.id}/files/dual`, {
      header: { range: 'bytes=0-9' },
    })
    expect(ctx.status).toBe(206)
    expect(ctx.responseHeaders['content-range']).toBe(`bytes 0-9/${dualBytes.length}`)
    expect(Number(ctx.responseHeaders['content-length'])).toBe(10)
    const body = await readStream(ctx.body)
    expect(body.equals(dualBytes.subarray(0, 10))).toBe(true)
  })

  it('supports open-ended and suffix ranges', async () => {
    const pdfPath = writeStubPdf('range-open.pdf')
    const submitted = await postJob({ pdfPath })
    const job = await waitForJob(submitted.body.job.id, 'completed')
    const dualBytes = readFileSync(job.dual_path)

    const openEnded = await dispatch(
      'GET',
      `/api/studio/research/library/translations/${job.id}/files/dual`,
      { header: { range: 'bytes=5-' } },
    )
    expect(openEnded.status).toBe(206)
    expect(openEnded.responseHeaders['content-range']).toBe(`bytes 5-${dualBytes.length - 1}/${dualBytes.length}`)
    const openBody = await readStream(openEnded.body)
    expect(openBody.equals(dualBytes.subarray(5))).toBe(true)

    const suffix = await dispatch(
      'GET',
      `/api/studio/research/library/translations/${job.id}/files/dual`,
      { header: { range: 'bytes=-4' } },
    )
    expect(suffix.status).toBe(206)
    expect(suffix.responseHeaders['content-range']).toBe(`bytes ${dualBytes.length - 4}-${dualBytes.length - 1}/${dualBytes.length}`)
    const suffixBody = await readStream(suffix.body)
    expect(suffixBody.equals(dualBytes.subarray(-4))).toBe(true)
  })

  it('rejects unsatisfiable ranges with 416 and serves the mono product', async () => {
    const pdfPath = writeStubPdf('range-416.pdf')
    const submitted = await postJob({ pdfPath })
    const job = await waitForJob(submitted.body.job.id, 'completed')
    const monoBytes = readFileSync(job.mono_path)

    const unsatisfiable = await dispatch(
      'GET',
      `/api/studio/research/library/translations/${job.id}/files/dual`,
      { header: { range: `bytes=${monoBytes.length + 100}-` } },
    )
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.responseHeaders['content-range']).toBe(`bytes */${monoBytes.length}`)

    const mono = await dispatch('GET', `/api/studio/research/library/translations/${job.id}/files/mono`)
    expect(mono.status).toBe(200)
    const monoBody = await readStream(mono.body)
    expect(monoBody.equals(monoBytes)).toBe(true)

    const badKind = await dispatch('GET', `/api/studio/research/library/translations/${job.id}/files/other`)
    expect(badKind.status).toBe(400)

    const missingJob = await dispatch('GET', '/api/studio/research/library/translations/nope/files/dual')
    expect(missingJob.status).toBe(404)
  })

  it('returns 404 for the dual product before the job completed', async () => {
    const pdfPath = writeStubPdf('range-early.pdf')
    process.env.PDF2ZH_STUB_MODE = 'slow'
    process.env.PAPER_TRANSLATE_JOB_TIMEOUT_MS = '1500'
    const submitted = await postJob({ pdfPath })
    const jobId = submitted.body.job.id
    const early = await dispatch('GET', `/api/studio/research/library/translations/${jobId}/files/dual`)
    expect(early.status).toBe(404)
    await waitForJob(jobId, 'failed', 10000)
  })
})

// ---------------------------------------------------------------------------
// Gated real-chain test: only runs when PAPER_TRANSLATE_E2E_PDF2ZH_BIN points
// at a working pdf2zh entrypoint that accepts the project argv contract
// (typically a wrapper adapter script). See
// docs/research-workbench/T3.2-sidecar-spike.md for the manual reproduction
// steps and the adapter this was validated with.
// ---------------------------------------------------------------------------
const REAL_PDF2ZH_BIN = process.env.PAPER_TRANSLATE_E2E_PDF2ZH_BIN?.trim() || ''
const describeRealChain = REAL_PDF2ZH_BIN ? describe : describe.skip

describeRealChain('research translation real pdf2zh chain (gated)', () => {
  it('translates a real one-page PDF into mono/dual products', async () => {
    process.env.PDF2ZH_STUB_MODE = 'ok' // unused by the real bin, keeps the stub inert
    process.env.PAPER_TRANSLATE_PDF2ZH_BIN = REAL_PDF2ZH_BIN
    const pdfPath = join(workDir, 'real-paper.pdf')
    writeFileSync(pdfPath, buildMinimalPdf('The quick brown fox jumps over the lazy dog.'))

    const submitted = await postJob({ pdfPath, targetLang: 'zh', service: 'google' })
    expect(submitted.status).toBe(202)
    const job = await waitForJob(submitted.body.job.id, 'completed', 540000)
    expect(job.status).toBe('completed')
    expect(job.mono_path).toBeTruthy()
    expect(job.dual_path).toBeTruthy()
    for (const product of [job.mono_path, job.dual_path]) {
      const bytes = readFileSync(product)
      expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
      expect(bytes.length).toBeGreaterThan(1000)
    }
  }, 600000)
})
