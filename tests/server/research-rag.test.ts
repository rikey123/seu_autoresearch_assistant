import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES_MODULE = '../../packages/server/src/modules/research/rag/index'
const STORE_MODULE = '../../packages/server/src/modules/research/rag/rag-store'
const SERVICE_MODULE = '../../packages/server/src/modules/research/rag/rag-service'
const SIDECAR_MODULE = '../../packages/server/src/modules/research/rag/rag-sidecar'
const PAPER_STORE_MODULE = '../../packages/server/src/modules/research/library/paper-store'

type RagModule = typeof import('../../packages/server/src/modules/research/rag/index')
type StoreModule = typeof import('../../packages/server/src/modules/research/rag/rag-store')
type ServiceModule = typeof import('../../packages/server/src/modules/research/rag/rag-service')
type SidecarModule = typeof import('../../packages/server/src/modules/research/rag/rag-sidecar')
type PaperStoreModule = typeof import('../../packages/server/src/modules/research/library/paper-store')

let home = ''
let workDir = ''
let routes: RagModule
let store: StoreModule
let service: ServiceModule
let sidecar: SidecarModule
let paperStore: PaperStoreModule

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
 * A structurally valid one-page PDF with visible Helvetica text. The stub
 * only needs the %PDF- header, but real parsers (pypdf inside paper-qa) need
 * a well-formed body, so the gated real-chain test uses this.
 */
function buildMinimalPdf(name: string, text: string): string {
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
  const pdfPath = join(workDir, name)
  writeFileSync(pdfPath, Buffer.from(body, 'latin1'))
  return pdfPath
}

function createLibraryPaper(name: string, title: string): string {
  const filePath = writeStubPdf(name)
  return paperStore.createPaper({ title, original_name: name, file_path: filePath, file_size: PDF_BYTES.length }).id
}

/**
 * The stub sidecar speaks the pinned JSON stdin/stdout contract. It logs every
 * received request object (and the process tree it spawned) to stub-calls.log,
 * then answers according to RAG_STUB_MODE.
 */
function writeStubScript(): string {
  const stubPath = join(workDir, 'rag-sidecar-stub.cjs')
  writeFileSync(stubPath, `const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let raw = '';
process.stdin.on('data', function (chunk) { raw += chunk; });
process.stdin.on('end', function () {
  const request = JSON.parse(raw);
  const mode = process.env.RAG_STUB_MODE || 'ok';
  const pids = { self: process.pid, child: null };
  fs.appendFileSync(path.join(__dirname, 'stub-calls.log'), JSON.stringify({
    request,
    mode,
    argvMode: process.env.RAG_STUB_MODE,
    pids,
    apiKey: process.env.OPENAI_API_KEY || null,
    baseUrl: process.env.OPENAI_BASE_URL || null,
    model: process.env.OPENAI_MODEL || null,
    embeddingModel: process.env.RAG_EMBEDDING_MODEL || null,
    allEnv: Object.keys(process.env).sort(),
  }) + '\\n');
  function respond(payload) {
    // Do NOT process.exit() here: on Windows the pipe flush callback can fire
    // while data is still in userspace buffers, and exit truncates the
    // stream. Returning from the 'end' handler lets node exit naturally with
    // everything flushed.
    process.stdout.write(JSON.stringify(payload) + '\\n');
  }
  if (mode === 'slow') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(function(){}, 60000)'], { stdio: 'ignore' });
    pids.child = child.pid;
    fs.appendFileSync(path.join(__dirname, 'stub-calls.log'), JSON.stringify({ pidsUpdate: pids }) + '\\n');
    setTimeout(function () { process.exit(9); }, 60000);
    return;
  }
  if (mode === 'fail') {
    process.stderr.write('stub index exploded intentionally\\n');
    respond({ status: 'error', error: 'stub sidecar failed on purpose' });
    return;
  }
  if (mode === 'crash') {
    process.stderr.write('stub crashed before answering\\n');
    process.exit(3);
  }
  if (mode === 'badjson') {
    process.stdout.write('this is not json at all\\n');
    return;
  }
  if (request.action === 'index') {
    respond({ status: 'ok', action: 'index', chunks: request.papers.length * 3, engine: 'stub-engine' });
    return;
  }
  if (mode === 'noanswer') {
    respond({ status: 'ok', action: 'ask', answer: '', citations: [], engine: 'stub-engine' });
    return;
  }
  if (mode === 'foreigncite') {
    // Citations carry a paperId that is NOT in the requested collection —
    // runQuestionTask must drop it (defense in depth for citation traceability).
    respond({
      status: 'ok',
      action: 'ask',
      answer: 'Answer citing a foreign paper id.',
      citations: (request.papers || []).map(function (paper, index) {
        return { paperId: paper.id, page: index + 1, snippet: 'own citation ' + paper.title };
      }).concat([{ paperId: 'ghost-paper-not-in-collection', page: 9, snippet: 'foreign citation' }]),
      engine: 'stub-engine',
    });
    return;
  }
  respond({
    status: 'ok',
    action: 'ask',
    answer: 'Stub answer for: ' + request.question,
    citations: (request.papers || []).map(function (paper, index) {
      return { paperId: paper.id, page: index === 0 ? 4 : null, snippet: 'stub snippet from ' + paper.title };
    }),
    engine: 'stub-engine',
  });
});
`)
  return stubPath
}

function stubCallsLog(): Array<Record<string, unknown>> {
  const logPath = join(workDir, 'stub-calls.log')
  try {
    return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

async function dispatch(method: string, path: string, body?: Record<string, unknown>) {
  const dispatchRoute = routes.ragRoutes.routes()
  const ctx: any = {
    method,
    path,
    query: {},
    params: {},
    header: {},
    request: { body: body ?? undefined },
    state: {},
    status: 200,
    body: undefined,
    set: () => {},
  }
  await dispatchRoute(ctx, async () => {})
  return ctx
}

async function createCollection(name: string, description = ''): Promise<string> {
  const ctx = await dispatch('POST', '/api/studio/research/rag/collections', { name, description })
  expect(ctx.status).toBe(201)
  return ctx.body.collection.id
}

async function addPaper(collectionId: string, paperId: string) {
  return dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/papers`, { paperId })
}

async function waitForJob(jobId: string, status: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = store.getIndexJob(jobId)
    if (job?.status === status) return job
    if (job?.status === 'failed' && status !== 'failed') {
      throw new Error(`job failed while waiting for ${status}: ${job.error}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for job ${jobId} to reach ${status}; last=${JSON.stringify(job)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function waitForQuestion(questionId: string, status: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const record = store.getQuestion(questionId)
    if (record?.status === status) return record
    if (record?.status === 'failed' && status !== 'failed') {
      throw new Error(`question failed while waiting for ${status}: ${record.error}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for question ${questionId} to reach ${status}; last=${JSON.stringify(record)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

beforeEach(async () => {
  vi.resetModules()
  home = mkdtempSync(join(tmpdir(), 'research-rag-home-'))
  workDir = mkdtempSync(join(tmpdir(), 'research-rag-work-'))
  process.env.HERMES_WEB_UI_HOME = home
  process.env.OPENAI_API_KEY = 'dummy-rag-key'
  process.env.OPENAI_BASE_URL = 'https://mock.example.invalid/v1'
  process.env.OPENAI_MODEL = 'mock-model'
  process.env.RAG_EMBEDDING_MODEL = 'mock-embedding'
  process.env.RAG_STUB_MODE = 'ok'
  delete process.env.RAG_SIDECAR_TIMEOUT_MS
  process.env.RAG_SIDECAR_BIN = writeStubScript()
  paperStore = await import(PAPER_STORE_MODULE)
  store = await import(STORE_MODULE)
  sidecar = await import(SIDECAR_MODULE)
  service = await import(SERVICE_MODULE)
  routes = await import(ROUTES_MODULE)
})

afterEach(async () => {
  service.stopRagWorker()
  // Give a just-killed child's close event a beat to settle before removing
  // the temp dirs (Windows keeps deleted-but-open SQLite files locked).
  await new Promise(resolve => setTimeout(resolve, 150))
  store.closeRagDb()
  paperStore.closePapersDb()
  for (const key of [
    'HERMES_WEB_UI_HOME',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'RAG_EMBEDDING_MODEL',
    'RAG_STUB_MODE',
    'RAG_SIDECAR_BIN',
    'RAG_SIDECAR_TIMEOUT_MS',
  ]) delete process.env[key]
  rmSync(home, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
  home = ''
  workDir = ''
})

describe('rag collection CRUD and membership', () => {
  it('creates, lists, updates, and deletes collections', async () => {
    const missingName = await dispatch('POST', '/api/studio/research/rag/collections', { description: 'x' })
    expect(missingName.status).toBe(400)
    expect(missingName.body.error).toContain('name is required')

    const id = await createCollection('Transformers', 'attention-era papers')
    const listed = await dispatch('GET', '/api/studio/research/rag/collections')
    expect(listed.status).toBe(200)
    expect(listed.body.collections).toHaveLength(1)
    expect(listed.body.collections[0]).toMatchObject({
      id,
      name: 'Transformers',
      description: 'attention-era papers',
      index_status: 'unindexed',
      paper_count: 0,
    })

    const patched = await dispatch('PATCH', `/api/studio/research/rag/collections/${id}`, {
      name: 'Transformers v2',
    })
    expect(patched.status).toBe(200)
    expect(patched.body.collection.name).toBe('Transformers v2')
    expect(patched.body.collection.description).toBe('attention-era papers')

    const emptyName = await dispatch('PATCH', `/api/studio/research/rag/collections/${id}`, { name: '  ' })
    expect(emptyName.status).toBe(400)

    const fetched = await dispatch('GET', `/api/studio/research/rag/collections/${id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.collection.name).toBe('Transformers v2')
    expect(fetched.body.members).toEqual([])

    const removed = await dispatch('DELETE', `/api/studio/research/rag/collections/${id}`)
    expect(removed.status).toBe(200)
    const gone = await dispatch('GET', `/api/studio/research/rag/collections/${id}`)
    expect(gone.status).toBe(404)

    const missing = await dispatch('DELETE', `/api/studio/research/rag/collections/${id}`)
    expect(missing.status).toBe(404)
  })

  it('manages member papers through library paper ids', async () => {
    const paperA = createLibraryPaper('a.pdf', 'Paper A')
    const paperB = createLibraryPaper('b.pdf', 'Paper B')
    const collectionId = await createCollection('Members')

    const noPaper = await addPaper(collectionId, 'does-not-exist')
    expect(noPaper.status).toBe(404)

    const added = await addPaper(collectionId, paperA)
    expect(added.status).toBe(201)
    expect(added.body.member).toMatchObject({ paper_id: paperA, title: 'Paper A', file_exists: true })

    const duplicate = await addPaper(collectionId, paperA)
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('already a member')

    await addPaper(collectionId, paperB)
    const members = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}/papers`)
    expect(members.body.members.map((entry: { paper_id: string }) => entry.paper_id).sort()).toEqual([paperA, paperB].sort())

    const removed = await dispatch('DELETE', `/api/studio/research/rag/collections/${collectionId}/papers/${paperB}`)
    expect(removed.status).toBe(200)
    const removedAgain = await dispatch('DELETE', `/api/studio/research/rag/collections/${collectionId}/papers/${paperB}`)
    expect(removedAgain.status).toBe(404)

    const listed = await dispatch('GET', '/api/studio/research/rag/collections')
    expect(listed.body.collections[0].paper_count).toBe(1)
  })

  it('marks a built index stale when membership changes', async () => {
    const paperA = createLibraryPaper('stale-a.pdf', 'Paper A')
    const paperB = createLibraryPaper('stale-b.pdf', 'Paper B')
    const collectionId = await createCollection('Stale')
    await addPaper(collectionId, paperA)

    await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    await waitForJob(store.getLatestIndexJob(collectionId)!.id, 'completed')

    let view = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}`)
    expect(view.body.collection.index_status).toBe('indexed')
    expect(view.body.collection.chunks).toBe(3)
    expect(view.body.collection.engine).toBe('stub-engine')

    await addPaper(collectionId, paperB)
    view = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}`)
    expect(view.body.collection.index_status).toBe('stale')
  })
})

describe('rag index job lifecycle through the sidecar stub', () => {
  it('fails fast with clear errors before spawning (no members, no sidecar, no key)', async () => {
    const collectionId = await createCollection('Gating')
    const paperId = createLibraryPaper('gate.pdf', 'Gate Paper')

    const noMembers = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(noMembers.status).toBe(400)
    expect(noMembers.body.error).toContain('at least one paper')

    await addPaper(collectionId, paperId)

    const noBin = process.env.RAG_SIDECAR_BIN
    delete process.env.RAG_SIDECAR_BIN
    const noSidecar = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(noSidecar.status).toBe(503)
    expect(noSidecar.body.error).toContain('RAG_SIDECAR_BIN')

    process.env.RAG_SIDECAR_BIN = noBin
    const noKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const missingKey = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(missingKey.status).toBe(503)
    expect(missingKey.body.error).toContain('OPENAI_API_KEY is not configured')
    process.env.OPENAI_API_KEY = noKey

    expect(stubCallsLog()).toHaveLength(0)
  })

  it('rejects a second index job while one is queued or running', async () => {
    const collectionId = await createCollection('Conflict')
    await addPaper(collectionId, createLibraryPaper('conflict.pdf', 'Conflict Paper'))
    process.env.RAG_STUB_MODE = 'slow'
    process.env.RAG_SIDECAR_TIMEOUT_MS = '1500'

    const first = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(first.status).toBe(202)
    const second = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(second.status).toBe(409)
    expect(second.body.error).toContain('already queued or running')

    await waitForJob(first.body.job.id, 'failed')
  })

  it('runs a full index job and records chunks, engine, and env passthrough', async () => {
    const paperId = createLibraryPaper('full.pdf', 'Full Paper')
    const collectionId = await createCollection('Full')
    await addPaper(collectionId, paperId)

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(submitted.status).toBe(202)
    expect(submitted.body.job.status).toBe('queued')

    const job = await waitForJob(submitted.body.job.id, 'completed')
    expect(job.chunks).toBe(3)
    expect(job.engine).toBe('stub-engine')
    expect(job.attempts).toBe(1)

    const view = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}`)
    expect(view.body.collection.index_status).toBe('indexed')
    expect(view.body.latest_index_job.id).toBe(job.id)

    const call = stubCallsLog().find(entry => entry.request) as { request: any; apiKey: string } | undefined
    expect(call).toBeTruthy()
    expect(call!.request.action).toBe('index')
    expect(call!.request.papers).toEqual([
      { id: paperId, title: 'Full Paper', path: join(workDir, 'full.pdf') },
    ])
    // API-first: the endpoint configuration travels through the environment.
    expect(call!.apiKey).toBe('dummy-rag-key')
  })

  it('does not leak unrelated secrets into the sidecar child environment', async () => {
    const paperId = createLibraryPaper('leak.pdf', 'Leak Paper')
    const collectionId = await createCollection('Leak')
    await addPaper(collectionId, paperId)

    process.env.UNRELATED_SECRET = 'must-not-reach-the-child'
    process.env.HOME_SOFTWARE_CREDENTIALS = 'do-not-export'
    try {
      const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
      await waitForJob(submitted.body.job.id, 'completed')

      const call = stubCallsLog().find(entry => entry.request) as { allEnv: string[] } | undefined
      expect(call).toBeTruthy()
      // Whitelist-only: unrelated secrets never reach the child (the OS may
      // inject system variables like PATH on Windows, but nothing from the
      // parent's custom environment that is not in the whitelist).
      expect(call!.allEnv).not.toContain('UNRELATED_SECRET')
      expect(call!.allEnv).not.toContain('HOME_SOFTWARE_CREDENTIALS')
      expect(call!.allEnv).not.toContain('HERMES_HOME')
      expect(call!.allEnv).toContain('OPENAI_API_KEY')
      expect(call!.allEnv).toContain('OPENAI_BASE_URL')
      expect(call!.allEnv).toContain('OPENAI_MODEL')
      expect(call!.allEnv).toContain('RAG_EMBEDDING_MODEL')
      expect(call!.allEnv).toContain('RAG_STUB_MODE')
    } finally {
      delete process.env.UNRELATED_SECRET
      delete process.env.HOME_SOFTWARE_CREDENTIALS
    }
  })

  it('records failure details when the sidecar reports an error response', async () => {
    const collectionId = await createCollection('Error')
    await addPaper(collectionId, createLibraryPaper('error.pdf', 'Error Paper'))
    process.env.RAG_STUB_MODE = 'fail'

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const job = await waitForJob(submitted.body.job.id, 'failed')
    expect(job.error).toContain('stub sidecar failed on purpose')
    const view = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}`)
    expect(view.body.collection.index_status).toBe('unindexed')
  })

  it('fails the job when the sidecar exits without valid JSON output', async () => {
    const collectionId = await createCollection('BadJson')
    await addPaper(collectionId, createLibraryPaper('badjson.pdf', 'Bad Json Paper'))
    process.env.RAG_STUB_MODE = 'badjson'

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const job = await waitForJob(submitted.body.job.id, 'failed')
    expect(job.error).toContain('no valid JSON response')
    expect(job.error).toContain('this is not json at all')
  })

  it('fails the job when the sidecar crashes with a non-zero exit code', async () => {
    const collectionId = await createCollection('Crash')
    await addPaper(collectionId, createLibraryPaper('crash.pdf', 'Crash Paper'))
    process.env.RAG_STUB_MODE = 'crash'

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const job = await waitForJob(submitted.body.job.id, 'failed')
    expect(job.error).toContain('exit code 3')
    expect(job.error).toContain('stub crashed before answering')
  })

  it('times out a stuck sidecar and kills the whole process tree', async () => {
    const collectionId = await createCollection('Timeout')
    await addPaper(collectionId, createLibraryPaper('stuck.pdf', 'Stuck Paper'))
    process.env.RAG_STUB_MODE = 'slow'
    // Generous window: under parallel test load the stub's node boot plus its
    // pidsUpdate logging can exceed a sub-second timeout — the property under
    // test is the tree kill, not the exact timing.
    process.env.RAG_SIDECAR_TIMEOUT_MS = '2500'

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const job = await waitForJob(submitted.body.job.id, 'failed', 10000)
    expect(job.error).toContain('timed out after 2500ms')
    expect(job.error).toContain('process tree was killed')

    // The stub spawned its own child and logged both pids; the timed-out tree
    // kill must take down both processes (BC-5 lifecycle standard).
    const updates = stubCallsLog().filter(entry => entry.pidsUpdate) as Array<{ pidsUpdate: { self: number; child: number } }>
    expect(updates).toHaveLength(1)
    const { self, child } = updates[0].pidsUpdate
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      let bothDead = true
      for (const pid of [self, child]) {
        try {
          process.kill(pid, 0)
          bothDead = false
        } catch {
          // ESRCH: process no longer exists
        }
      }
      if (bothDead) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('sidecar process tree survived the timeout kill')
  })

  it('fails the job when every member PDF is missing on disk', async () => {
    const paperId = createLibraryPaper('vanish.pdf', 'Vanish Paper')
    const collectionId = await createCollection('Vanish')
    await addPaper(collectionId, paperId)
    rmSync(join(workDir, 'vanish.pdf'))

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const job = await waitForJob(submitted.body.job.id, 'failed')
    expect(job.error).toContain('no readable member PDFs')
    expect(stubCallsLog().filter(entry => entry.request)).toHaveLength(0)
  })

  it('drains multiple index jobs serially in submission order', async () => {
    const firstCollection = await createCollection('Serial A')
    const secondCollection = await createCollection('Serial B')
    await addPaper(firstCollection, createLibraryPaper('serial-a.pdf', 'Serial A'))
    await addPaper(secondCollection, createLibraryPaper('serial-b.pdf', 'Serial B'))

    const first = await dispatch('POST', `/api/studio/research/rag/collections/${firstCollection}/index`)
    const second = await dispatch('POST', `/api/studio/research/rag/collections/${secondCollection}/index`)
    await waitForJob(first.body.job.id, 'completed')
    await waitForJob(second.body.job.id, 'completed')

    const calls = stubCallsLog().filter(entry => entry.request)
    expect(calls).toHaveLength(2)
    expect((calls[0] as { request: { papers: Array<{ title: string }> } }).request.papers[0].title).toBe('Serial A')
    expect((calls[1] as { request: { papers: Array<{ title: string }> } }).request.papers[0].title).toBe('Serial B')
  })
})

describe('rag cited question answering through the sidecar stub', () => {
  async function indexedCollection(name: string): Promise<string> {
    const collectionId = await createCollection(name)
    await addPaper(collectionId, createLibraryPaper(`${name.toLowerCase()}.pdf`, `${name} Paper`))
    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    await waitForJob(submitted.body.job.id, 'completed')
    return collectionId
  }

  it('rejects questions before the collection is indexed', async () => {
    const collectionId = await createCollection('NotIndexed')
    await addPaper(collectionId, createLibraryPaper('notindexed.pdf', 'Not Indexed Paper'))

    const rejected = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'Too early?',
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toContain('index the collection before asking')
  })

  it('answers with citations shaped as paperId/page/snippet and keeps history', async () => {
    const collectionId = await indexedCollection('Cited')

    const missing = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {})
    expect(missing.status).toBe(400)
    expect(missing.body.error).toContain('question is required')

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'What is the attention mechanism?',
    })
    expect(submitted.status).toBe(202)
    expect(submitted.body.question.status).toBe('queued')

    const answered = await waitForQuestion(submitted.body.question.id, 'answered')
    expect(answered.answer).toBe('Stub answer for: What is the attention mechanism?')
    expect(answered.engine).toBe('stub-engine')
    expect(answered.citations).toHaveLength(1)
    expect(answered.citations[0]).toEqual({
      paperId: expect.any(String),
      page: 4,
      snippet: expect.stringContaining('stub snippet'),
    })
    expect(typeof answered.citations[0].paperId).toBe('string')

    const askCall = stubCallsLog().filter(entry => entry.request)
      .map(entry => (entry as { request: { action: string; question?: string } }).request)
      .find(request => request.action === 'ask')
    expect(askCall?.question).toBe('What is the attention mechanism?')

    const status = await dispatch('GET', `/api/studio/research/rag/questions/${submitted.body.question.id}`)
    expect(status.status).toBe(200)
    expect(status.body.question.status).toBe('answered')

    const history = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}/history`)
    expect(history.status).toBe(200)
    expect(history.body.history).toHaveLength(1)
    expect(history.body.history[0].citations[0].page).toBe(4)

    const missingHistory = await dispatch('GET', '/api/studio/research/rag/collections/nope/history')
    expect(missingHistory.status).toBe(404)
  })

  it('marks the question failed when the sidecar reports an error', async () => {
    const collectionId = await indexedCollection('AskFail')
    process.env.RAG_STUB_MODE = 'fail'
    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'Why fail?',
    })
    const record = await waitForQuestion(submitted.body.question.id, 'failed')
    expect(record.error).toContain('stub sidecar failed on purpose')
    expect(record.answer).toBeNull()
  })

  it('marks the question failed when the sidecar answers with empty text', async () => {
    const collectionId = await indexedCollection('AskEmpty')
    process.env.RAG_STUB_MODE = 'noanswer'
    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'Say nothing.',
    })
    const record = await waitForQuestion(submitted.body.question.id, 'failed')
    expect(record.error).toContain('no answer text')
  })

  it('drops citations whose paperId is not a member of the collection', async () => {
    const collectionId = await indexedCollection('ForeignCite')
    process.env.RAG_STUB_MODE = 'foreigncite'
    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'Which citation is mine?',
    })
    const record = await waitForQuestion(submitted.body.question.id, 'answered')
    // The member citation survives; the foreign paperId is filtered out before
    // persistence (defense in depth, never rendered as broken traceability).
    expect(record.citations).toHaveLength(1)
    expect(record.citations[0].page).toBe(1)
    expect(record.citations[0].snippet).toContain('own citation')
    expect(record.citations[0].paperId).not.toBe('ghost-paper-not-in-collection')

    const history = await dispatch('GET', `/api/studio/research/rag/collections/${collectionId}/history`)
    expect(history.body.history[0].citations).toHaveLength(1)
  })

  it('rejects questions while an index job is running', async () => {
    const collectionId = await createCollection('Indexing')
    await addPaper(collectionId, createLibraryPaper('indexing.pdf', 'Indexing Paper'))
    process.env.RAG_STUB_MODE = 'slow'
    process.env.RAG_SIDECAR_TIMEOUT_MS = '1500'
    await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)

    const rejected = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'Ready yet?',
    })
    expect(rejected.status).toBe(409)
    expect(rejected.body.error).toContain('wait for the index job')
    await waitForJob(store.getLatestIndexJob(collectionId)!.id, 'failed')
  })
})

describe('rag restart recovery and worker stop', () => {
  it('marks running tasks failed and resets indexing collections on reopen', async () => {
    const collectionId = await createCollection('Recover')
    await addPaper(collectionId, createLibraryPaper('recover.pdf', 'Recover Paper'))
    await addPaper(collectionId, createLibraryPaper('recover2.pdf', 'Recover Two'))
    process.env.RAG_STUB_MODE = 'slow'

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const jobId = submitted.body.job.id
    const deadline = Date.now() + 5000
    while (store.getIndexJob(jobId)?.status !== 'running') {
      if (Date.now() > deadline) throw new Error('job never started running')
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    // Simulate a server restart: close and reopen the database. A persisted
    // running row cannot survive the restart, so the reopen must move it to
    // failed and release the transient 'indexing' collection state.
    store.closeRagDb()
    store.getRagDb()
    const job = store.getIndexJob(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('interrupted: server restarted')

    const collection = store.getCollection(collectionId)
    expect(collection?.index_status).toBe('unindexed')
  })

  it('fails leftover queued rows too when the database reopens', async () => {
    // The in-memory worker queue died with the old process, so a persisted
    // queued row can never start: the reopen must fail it instead of leaving
    // a zombie entry that distorts getLatestIndexJob forever.
    const collectionId = await createCollection('ZombieQueue')
    await addPaper(collectionId, createLibraryPaper('zombie.pdf', 'Zombie Paper'))
    const queuedJob = store.insertIndexJob({ collection_id: collectionId, papers_count: 1 })
    const queuedRunning = store.insertIndexJob({ collection_id: collectionId, papers_count: 1 })
    store.updateIndexJob(queuedRunning.id, { status: 'running', started_at: Date.now() })
    const queuedQuestion = store.insertQuestion(collectionId, 'queued zombie question')
    store.updateQuestion(queuedQuestion.id, { status: 'running' })
    const queuedQuestionIdle = store.insertQuestion(collectionId, 'idle queued question')
    // getLatestIndexJob reports the newest row by created_at — after the
    // reopen, every row must be terminal so the view cannot regress (the
    // sub-millisecond insert tie can order either job first, so assert the
    // full set instead of a specific pre-reopen status).
    expect(['queued', 'running']).toContain(store.getLatestIndexJob(collectionId)?.status)

    store.closeRagDb()
    store.getRagDb()

    const failedJob = store.getIndexJob(queuedJob.id)
    expect(failedJob?.status).toBe('failed')
    expect(failedJob?.error).toContain('interrupted: server restarted')
    const failedJob2 = store.getIndexJob(queuedRunning.id)
    expect(failedJob2?.status).toBe('failed')
    expect(failedJob2?.error).toContain('interrupted: server restarted')
    const failedQuestion = store.getQuestion(queuedQuestion.id)
    expect(failedQuestion?.status).toBe('failed')
    expect(failedQuestion?.error).toContain('interrupted: server restarted')
    expect(store.getQuestion(queuedQuestionIdle.id)?.status).toBe('failed')

    const latest = store.getLatestIndexJob(collectionId)
    expect(latest?.status).toBe('failed')
    expect(store.nextQueuedIndexJob()).toBeNull()
    expect(store.nextQueuedQuestion()).toBeNull()
  })

  it('stops the worker and kills the in-flight sidecar on stopRagWorker', async () => {
    const collectionId = await createCollection('Stop')
    await addPaper(collectionId, createLibraryPaper('stop.pdf', 'Stop Paper'))
    process.env.RAG_STUB_MODE = 'slow'

    const submitted = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    const jobId = submitted.body.job.id
    const deadline = Date.now() + 5000
    while (store.getIndexJob(jobId)?.status !== 'running') {
      if (Date.now() > deadline) throw new Error('job never started running')
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    // The stub logs its own pid and its child's pid shortly after node boots;
    // wait for that entry first — it proves the tree is alive — then stop.
    const logDeadline = Date.now() + 5000
    let updates: Array<{ pidsUpdate: { self: number; child: number } }> = []
    while (Date.now() < logDeadline) {
      updates = stubCallsLog().filter(entry => entry.pidsUpdate) as Array<{ pidsUpdate: { self: number; child: number } }>
      if (updates.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(updates.length).toBeGreaterThanOrEqual(1)

    service.stopRagWorker()
    const { self, child } = updates[updates.length - 1].pidsUpdate
    const killDeadline = Date.now() + 8000
    for (;;) {
      let bothDead = true
      for (const pid of [self, child]) {
        try {
          process.kill(pid, 0)
          bothDead = false
        } catch {
          // ESRCH: process no longer exists
        }
      }
      if (bothDead) return
      if (Date.now() > killDeadline) throw new Error('in-flight sidecar survived stopRagWorker')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  })
})

describe('rag sidecar protocol parser hardening', () => {
  it('parses the response object even when a banner pollutes stdout', () => {
    const banner = '\u001b[31mProvider List: https://example.invalid\u001b[0m\n'
    const parsed = sidecar.parseSidecarStdout(
      `${banner}\n${banner}{"status":"ok","action":"ask","answer":"final","citations":[{"paperId":"p1","page":2,"snippet":"s"}],"engine":"e"}\n`,
    )
    expect(parsed).toMatchObject({ status: 'ok', answer: 'final', engine: 'e' })
    expect(parsed?.citations).toEqual([{ paperId: 'p1', page: 2, snippet: 's' }])
  })

  it('drops malformed citations and non-integer pages', () => {
    const parsed = sidecar.parseSidecarStdout(
      '{"status":"ok","action":"ask","answer":"a","citations":[{"paperId":"p1","page":1.5,"snippet":"kept"},{},{"page":3}]}',
    )
    expect(parsed?.citations).toEqual([{ paperId: 'p1', page: null, snippet: 'kept' }])
  })

  it('returns null for empty or non-JSON stdout', () => {
    expect(sidecar.parseSidecarStdout('')).toBeNull()
    expect(sidecar.parseSidecarStdout('totally broken')).toBeNull()
  })

  it('resolves the launch command for node, python, and raw binaries', () => {
    expect(sidecar.resolveSidecarLaunch({})).toBeNull()
    const node = sidecar.resolveSidecarLaunch({ RAG_SIDECAR_BIN: 'wrap.cjs' })
    expect(node?.args).toEqual(['wrap.cjs'])
    const python = sidecar.resolveSidecarLaunch({
      RAG_SIDECAR_BIN: 'adapter.py',
      RAG_SIDECAR_PYTHON: 'C:/Python312/python.exe',
    })
    expect(python?.bin).toBe('C:/Python312/python.exe')
    expect(python?.args).toEqual(['adapter.py'])
    const raw = sidecar.resolveSidecarLaunch({ RAG_SIDECAR_BIN: 'C:/tools/sidecar.exe' })
    expect(raw).toEqual({ bin: 'C:/tools/sidecar.exe', args: [] })
  })

  it('passes only the pinned API-first variables through to the sidecar', () => {
    const env = sidecar.sidecarEnv({
      OPENAI_API_KEY: 'k',
      OPENAI_BASE_URL: 'https://api.example.invalid/v1',
      OPENAI_MODEL: 'm',
      RAG_EMBEDDING_MODEL: 'emb',
      RAG_EMBEDDING_BASE_URL: 'https://embedding.example.invalid/v1',
      RAG_STUB_MODE: 'slow',
      UNRELATED_SECRET: 'must-not-leak',
      PATH: 'C:/Windows/System32',
      HOME: 'C:/Users/exam',
      HERMES_HOME: 'C:/secret/agent-root',
    })
    // Whitelist-only: the exact key set, nothing more — the sidecar process
    // must never inherit the full parent environment.
    expect(Object.keys(env).sort()).toEqual([
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_MODEL',
      'RAG_EMBEDDING_BASE_URL',
      'RAG_EMBEDDING_MODEL',
      'RAG_STUB_MODE',
    ])
    expect(env.OPENAI_API_KEY).toBe('k')
    expect(env.OPENAI_BASE_URL).toBe('https://api.example.invalid/v1')
    expect(env.OPENAI_MODEL).toBe('m')
    expect(env.RAG_EMBEDDING_MODEL).toBe('emb')
    expect(env.RAG_EMBEDDING_BASE_URL).toBe('https://embedding.example.invalid/v1')
    expect(env.RAG_STUB_MODE).toBe('slow')
    expect(env.UNRELATED_SECRET).toBeUndefined()
    expect(env.HERMES_HOME).toBeUndefined()
    expect(env.PATH).toBeUndefined()
    expect(env.HOME).toBeUndefined()
  })

  it('omits whitelist keys that are unset in the parent environment', () => {
    const env = sidecar.sidecarEnv({ OPENAI_API_KEY: 'k' })
    expect(Object.keys(env)).toEqual(['OPENAI_API_KEY'])
  })
})

// ---------------------------------------------------------------------------
// Gated real-chain test: only runs when RAG_SIDECAR_E2E_BIN points at the
// paper-qa sidecar adapter (docs/research-workbench/sidecars/paperqa-sidecar.py)
// executed by a Python 3.10-3.12 environment with paper-qa installed, and
// OPENAI_API_KEY/OPENAI_BASE_URL point at a reachable OpenAI-compatible
// endpoint. Endpoint values are captured at module load because beforeEach
// swaps in dummy values for the stub tests. See
// docs/research-workbench/T4.1-rag-spike.md for the validated reproduction.
// ---------------------------------------------------------------------------
const REAL_SIDECAR = process.env.RAG_SIDECAR_E2E_BIN?.trim() || ''
const REAL_PYTHON = process.env.RAG_SIDECAR_E2E_PYTHON?.trim() || ''
const REAL_ENDPOINT = {
  apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  baseUrl: process.env.OPENAI_BASE_URL?.trim() || '',
  model: process.env.OPENAI_MODEL?.trim() || '',
  embedding: process.env.RAG_EMBEDDING_MODEL?.trim() || '',
}
const describeRealChain = REAL_SIDECAR && REAL_PYTHON && REAL_ENDPOINT.apiKey && REAL_ENDPOINT.baseUrl
  ? describe
  : describe.skip

describeRealChain('rag real paper-qa chain (gated)', () => {
  it('indexes a real PDF and answers a question with a citation', async () => {
    process.env.RAG_STUB_MODE = 'ok' // unused by the real adapter, keeps the stub inert
    process.env.RAG_SIDECAR_BIN = REAL_SIDECAR
    process.env.RAG_SIDECAR_PYTHON = REAL_PYTHON
    process.env.OPENAI_API_KEY = REAL_ENDPOINT.apiKey
    process.env.OPENAI_BASE_URL = REAL_ENDPOINT.baseUrl
    if (REAL_ENDPOINT.model) process.env.OPENAI_MODEL = REAL_ENDPOINT.model
    if (REAL_ENDPOINT.embedding) process.env.RAG_EMBEDDING_MODEL = REAL_ENDPOINT.embedding
    const pdfPath = buildMinimalPdf(
      'real-rag-paper.pdf',
      'The research workbench indexes academic papers for cited question answering. '
        + 'Knowledge base retrieval uses an OpenAI-compatible API endpoint.',
    )
    const paperId = paperStore.createPaper({
      title: 'Real RAG Paper',
      original_name: 'real-rag-paper.pdf',
      file_path: pdfPath,
      file_size: 2048,
    }).id
    const collectionId = await createCollection('Real Chain')
    await addPaper(collectionId, paperId)

    const indexed = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/index`)
    expect(indexed.status).toBe(202)
    const job = await waitForJob(indexed.body.job.id, 'completed', 300000)
    expect(job.status).toBe('completed')
    expect(job.engine).toBe('paper-qa')
    expect(job.chunks).toBeGreaterThan(0)

    const asked = await dispatch('POST', `/api/studio/research/rag/collections/${collectionId}/ask`, {
      question: 'What does this paper describe?',
    })
    expect(asked.status).toBe(202)
    const answered = await waitForQuestion(asked.body.question.id, 'answered', 300000)
    expect(answered.status).toBe('answered')
    expect(answered.answer).toBeTruthy()
    expect(answered.citations[0].paperId).toBe(paperId)
    expect(typeof answered.citations[0].snippet).toBe('string')
  }, 620000)
})
