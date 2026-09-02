import { mkdtempSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROUTES_MODULE = '../../packages/server/src/modules/research/library/index'
const STORE_MODULE = '../../packages/server/src/modules/research/library/paper-store'

type LibraryModule = typeof import('../../packages/server/src/modules/research/library/index')
type PaperStoreModule = typeof import('../../packages/server/src/modules/research/library/paper-store')

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n%fake minimal pdf for tests\n')

let home = ''
let routes: LibraryModule
let store: PaperStoreModule

function multipartBody(
  fields: Record<string, string>,
  file: { name: string; data: Buffer; fieldName?: string },
): { buffer: Buffer; contentType: string } {
  const boundary = '----vitestresearchlibrary'
  const segments: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    segments.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ))
  }
  segments.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName || 'file'}"; filename="${file.name}"\r\nContent-Type: application/pdf\r\n\r\n`,
  ))
  segments.push(file.data)
  segments.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    buffer: Buffer.concat(segments),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function iterableReq(buffer: Buffer) {
  return {
    async *[Symbol.asyncIterator]() {
      // Yield in two chunks so multipart reassembly is exercised.
      yield buffer.subarray(0, Math.ceil(buffer.length / 2))
      yield buffer.subarray(Math.ceil(buffer.length / 2))
    },
  }
}

// Dispatch through the real router middleware so path params and method
// matching behave like an incoming request.
async function dispatch(method: string, path: string, overrides: Record<string, unknown> = {}) {
  const dispatchRoute = routes.libraryRoutes.routes()
  const ctx: any = {
    method,
    path,
    query: {},
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

async function uploadPaper(overrides: {
  fields?: Record<string, string>
  file?: { name: string; data: Buffer }
} = {}) {
  const body = multipartBody(overrides.fields || {}, overrides.file || { name: 'paper.pdf', data: MINIMAL_PDF })
  return dispatch('POST', '/api/studio/research/library/papers', {
    headers: { 'content-type': body.contentType },
    req: iterableReq(body.buffer),
  })
}

async function drainBody(ctx: any): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of ctx.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

// Large payloads must be compared with the native Buffer equality (vitest's
// structural toEqual walks megabyte buffers byte-by-byte and times out).
async function drainBodyEquals(ctx: any, expected: Buffer): Promise<boolean> {
  return (await drainBody(ctx)).equals(expected)
}

// Builds a multi-megabyte "PDF": real header/trailer bytes around a large
// filler body, so range assertions exercise seeking inside a big stream
// without shipping a real document into the repository.
function largePdfBytes(megabytes: number): Buffer {
  const body = Buffer.alloc(megabytes * 1024 * 1024, 0x61)
  const header = Buffer.from('%PDF-1.4\n')
  const trailer = Buffer.from('\n%%EOF\n')
  body[0] = 0x25 // keep the interior distinguishable from header/trailer
  return Buffer.concat([header, body, trailer])
}

describe('research paper library', () => {
  beforeEach(async () => {
    vi.resetModules()
    home = mkdtempSync(join(tmpdir(), 'research-library-'))
    process.env.HERMES_WEB_UI_HOME = home
    store = await import(STORE_MODULE)
    routes = await import(ROUTES_MODULE)
  })

  afterEach(async () => {
    store.closePapersDb()
    delete process.env.HERMES_WEB_UI_HOME
    delete process.env.HERMES_MAX_PAPER_UPLOAD_SIZE
    vi.unstubAllEnvs()
    // Let queued stream opens land while the temp files still exist; a late
    // open after the recursive delete surfaces as an unhandled ENOENT.
    await new Promise(resolve => setTimeout(resolve, 50))
    rmSync(home, { recursive: true, force: true })
    home = ''
  })

  it('initializes the papers table with the library columns and index', () => {
    const db = store.getPapersDb()

    const columns = (db.prepare('PRAGMA table_info(papers)').all() as Array<{ name: string }>)
      .map(column => column.name)
    expect(columns).toEqual([
      'id', 'title', 'original_name', 'authors', 'year', 'venue', 'tags', 'file_path', 'file_size', 'created_at', 'updated_at',
    ])

    const indexes = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'papers'",
    ).all() as Array<{ name: string }>).map(index => index.name)
    expect(indexes).toContain('idx_papers_created_at')
  })

  it('uploads a PDF into the library with its original file name', async () => {
    const ctx = await uploadPaper({
      fields: { title: 'Attention Is All You Need', authors: 'Vaswani, Shen', year: '2017', venue: 'NeurIPS', tags: 'transformers, attention' },
      file: { name: 'attention.pdf', data: MINIMAL_PDF },
    })

    expect(ctx.status).toBe(201)
    const paper = ctx.body.paper
    expect(paper).toMatchObject({
      title: 'Attention Is All You Need',
      original_name: 'attention.pdf',
      authors: ['Vaswani', 'Shen'],
      year: 2017,
      venue: 'NeurIPS',
      tags: ['transformers', 'attention'],
    })
    expect(paper.id).toBeTruthy()
    expect(existsSync(paper.file_path)).toBe(true)
    expect(paper.file_path.startsWith(join(home, 'research', 'papers'))).toBe(true)
    expect(paper.file_size).toBe(MINIMAL_PDF.length)
    expect(paper.created_at).toBeGreaterThan(0)
  })

  it('falls back to the uploaded filename for the title', async () => {
    const ctx = await uploadPaper({ file: { name: 'Survey 2026.pdf', data: MINIMAL_PDF } })
    expect(ctx.status).toBe(201)
    expect(ctx.body.paper).toMatchObject({ title: 'Survey 2026', original_name: 'Survey 2026.pdf' })
  })

  it('rejects non-PDF uploads and oversized uploads', async () => {
    const notPdf = await uploadPaper({ file: { name: 'notes.txt', data: Buffer.from('hello') } })
    expect(notPdf.status).toBe(400)
    expect(notPdf.body.error).toContain('PDF')

    const wrongExt = await uploadPaper({ file: { name: 'paper.png', data: MINIMAL_PDF } })
    expect(wrongExt.status).toBe(400)

    process.env.HERMES_MAX_PAPER_UPLOAD_SIZE = String(MINIMAL_PDF.length - 1)
    const oversize = await uploadPaper()
    expect(oversize.status).toBe(413)

    const missingFile = await dispatch('POST', '/api/studio/research/library/papers', {
      headers: { 'content-type': 'application/json' },
      req: iterableReq(Buffer.from('{}')),
    })
    expect(missingFile.status).toBe(400)

    expect(store.listPapers()).toHaveLength(0)
  })

  it('lists papers newest first with metadata and filters by tag', async () => {
    const first = await uploadPaper({ fields: { title: 'Older paper', tags: 'ml' } })
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await uploadPaper({ fields: { title: 'Newer paper', tags: 'ml, nlp' } })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const all = await dispatch('GET', '/api/studio/research/library/papers')
    expect(all.status).toBe(200)
    expect(all.body.papers.map((p: any) => p.title)).toEqual(['Newer paper', 'Older paper'])
    for (const paper of all.body.papers) {
      expect(typeof paper.file_size).toBe('number')
      expect(typeof paper.created_at).toBe('number')
      expect(typeof paper.original_name).toBe('string')
    }

    const byTag = await dispatch('GET', '/api/studio/research/library/papers', { query: { tag: 'nlp' } })
    expect(byTag.body.papers.map((p: any) => p.title)).toEqual(['Newer paper'])

    const unknownTag = await dispatch('GET', '/api/studio/research/library/papers', { query: { tag: 'quantum' } })
    expect(unknownTag.body.papers).toEqual([])
  })

  it('returns paper details and 404 for unknown ids', async () => {
    const created = await uploadPaper({ fields: { title: 'Detail paper' } })
    const id = created.body.paper.id

    const detail = await dispatch('GET', `/api/studio/research/library/papers/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.paper).toMatchObject({ id, title: 'Detail paper' })

    const missing = await dispatch('GET', '/api/studio/research/library/papers/does-not-exist')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'paper not found' })
  })

  it('retrieves papers by original file name for metadata and bytes', async () => {
    const created = await uploadPaper({ file: { name: 'Attention Is All You Need.pdf', data: MINIMAL_PDF } })
    expect(created.status).toBe(201)

    const byName = await dispatch('GET', '/api/studio/research/library/papers/by-name/Attention Is All You Need.pdf')
    expect(byName.status).toBe(200)
    const paper = byName.body.paper
    expect(paper).toMatchObject({ original_name: 'Attention Is All You Need.pdf', file_size: MINIMAL_PDF.length })

    const fileByName = await dispatch('GET', `/api/studio/research/library/papers/by-name/${encodeURIComponent('Attention Is All You Need.pdf')}/file`)
    expect(fileByName.status).toBe(200)
    expect(fileByName.headers['content-type']).toBe('application/pdf')
    expect(await drainBody(fileByName)).toEqual(MINIMAL_PDF)

    const missing = await dispatch('GET', '/api/studio/research/library/papers/by-name/unknown.pdf')
    expect(missing.status).toBe(404)

    const missingFile = await dispatch('GET', '/api/studio/research/library/papers/by-name/unknown.pdf/file')
    expect(missingFile.status).toBe(404)
  })

  it('updates metadata through PATCH and validates payloads', async () => {
    const created = await uploadPaper({ fields: { title: 'Draft', tags: 'ml' } })
    const id = created.body.paper.id

    const patched = await dispatch('PATCH', `/api/studio/research/library/papers/${id}`, {
      request: { body: { venue: 'ICML', year: 2025, tags: ['ml', 'optimization'] } },
    })
    expect(patched.status).toBe(200)
    expect(patched.body.paper).toMatchObject({ id, venue: 'ICML', year: 2025, tags: ['ml', 'optimization'] })
    expect(patched.body.paper.original_name).toBe(created.body.paper.original_name)

    const invalidYear = await dispatch('PATCH', `/api/studio/research/library/papers/${id}`, {
      request: { body: { year: 'twenty' } },
    })
    expect(invalidYear.status).toBe(400)
    expect(invalidYear.body.error).toContain('year must be an integer')

    const emptyTitle = await dispatch('PATCH', `/api/studio/research/library/papers/${id}`, {
      request: { body: { title: '   ' } },
    })
    expect(emptyTitle.status).toBe(400)

    const missing = await dispatch('PATCH', '/api/studio/research/library/papers/does-not-exist', {
      request: { body: { venue: 'ICML' } },
    })
    expect(missing.status).toBe(404)
  })

  it('deletes a paper together with its stored file', async () => {
    const created = await uploadPaper({ fields: { title: 'Doomed paper' } })
    const id = created.body.paper.id
    const filePath: string = created.body.paper.file_path
    expect(existsSync(filePath)).toBe(true)

    const deleted = await dispatch('DELETE', `/api/studio/research/library/papers/${id}`)
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ ok: true })
    expect(existsSync(filePath)).toBe(false)
    expect(store.getPaper(id)).toBeNull()

    const again = await dispatch('DELETE', `/api/studio/research/library/papers/${id}`)
    expect(again.status).toBe(404)
  })

  it('streams a multi-megabyte PDF with byte-range responses', async () => {
    const payload = largePdfBytes(3)
    expect(payload.length).toBeGreaterThan(3 * 1024 * 1024)
    const created = await uploadPaper({ file: { name: 'big.pdf', data: payload } })
    const id = created.body.paper.id
    const fileUrl = `/api/studio/research/library/papers/${id}/file`

    // No Range header: 200 with the full body and range metadata advertised.
    const full = await dispatch('GET', fileUrl)
    expect(full.status).toBe(200)
    expect(full.headers['accept-ranges']).toBe('bytes')
    expect(full.headers['content-type']).toBe('application/pdf')
    expect(full.length).toBe(payload.length)
    expect(await drainBodyEquals(full, payload)).toBe(true)

    // Browsers issue this exact mid-file range when seeking into large PDFs.
    const middleStart = Math.floor(payload.length / 2)
    const middle = await dispatch('GET', fileUrl, { headers: { range: `bytes=${middleStart}-${middleStart + 1023}` } })
    expect(middle.status).toBe(206)
    expect(middle.headers['content-range']).toBe(`bytes ${middleStart}-${middleStart + 1023}/${payload.length}`)
    expect(middle.length).toBe(1024)
    expect(await drainBodyEquals(middle, payload.subarray(middleStart, middleStart + 1024))).toBe(true)

    const partial = await dispatch('GET', fileUrl, { headers: { range: `bytes=5-9` } })
    expect(partial.status).toBe(206)
    expect(partial.headers['content-range']).toBe(`bytes 5-9/${payload.length}`)
    expect(partial.headers['accept-ranges']).toBe('bytes')
    expect(await drainBodyEquals(partial, payload.subarray(5, 10))).toBe(true)

    const openEnded = await dispatch('GET', fileUrl, { headers: { range: `bytes=${payload.length - 3}-` } })
    expect(openEnded.status).toBe(206)
    expect(openEnded.headers['content-range']).toBe(`bytes ${payload.length - 3}-${payload.length - 1}/${payload.length}`)
    expect(await drainBodyEquals(openEnded, payload.subarray(payload.length - 3))).toBe(true)

    const suffix = await dispatch('GET', fileUrl, { headers: { range: `bytes=-6` } })
    expect(suffix.status).toBe(206)
    expect(await drainBodyEquals(suffix, payload.subarray(payload.length - 6))).toBe(true)

    // End beyond EOF is clamped to the last byte instead of failing.
    const clamped = await dispatch('GET', fileUrl, { headers: { range: `bytes=${payload.length - 2}-${payload.length + 500}` } })
    expect(clamped.status).toBe(206)
    expect(clamped.headers['content-range']).toBe(`bytes ${payload.length - 2}-${payload.length - 1}/${payload.length}`)
    expect(await drainBodyEquals(clamped, payload.subarray(payload.length - 2))).toBe(true)

    const unsatisfiable = await dispatch('GET', fileUrl, { headers: { range: `bytes=${payload.length + 10}-` } })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${payload.length}`)

    // Malformed and multi-range headers fall back to the full 200 response.
    const malformed = await dispatch('GET', fileUrl, { headers: { range: 'bytes=abc' } })
    expect(malformed.status).toBe(200)
    expect(await drainBodyEquals(malformed, payload)).toBe(true)

    const multiRange = await dispatch('GET', fileUrl, { headers: { range: 'bytes=0-1,4-5' } })
    expect(multiRange.status).toBe(200)
    expect(await drainBodyEquals(multiRange, payload)).toBe(true)

    // HEAD advertises the same streaming metadata; drain the underlying body
    // so the open file handle is released before the temp dir is removed.
    const head = await dispatch('HEAD', fileUrl)
    expect(head.headers['accept-ranges']).toBe('bytes')
    expect(head.headers['content-type']).toBe('application/pdf')
    await drainBody(head)
  }, 20000)

  it('reports 404 for the streaming endpoint when the paper or file is missing', async () => {
    const missingPaper = await dispatch('GET', '/api/studio/research/library/papers/nope/file')
    expect(missingPaper.status).toBe(404)
    expect(missingPaper.body).toEqual({ error: 'paper not found' })

    const created = await uploadPaper({ fields: { title: 'Ghost file' } })
    const filePath: string = created.body.paper.file_path
    unlinkSync(filePath)

    const missingFile = await dispatch('GET', `/api/studio/research/library/papers/${created.body.paper.id}/file`)
    expect(missingFile.status).toBe(404)
    expect(missingFile.body).toEqual({ error: 'paper file not found' })
  })

  it('keeps the health probe untouched', async () => {
    const ctx = await dispatch('GET', '/api/studio/research/library/health')
    expect(ctx.body).toEqual({ ok: true, subdomain: 'library' })
  })
})
