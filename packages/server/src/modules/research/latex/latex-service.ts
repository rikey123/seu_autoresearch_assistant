// Validation and domain rules for LaTeX documents and compilations.
import {
  COMPILATION_STATUSES,
  createCompilation,
  createDocument,
  deleteDocument,
  findActiveCompilationForDocument,
  getCompilation,
  getDocument,
  latestCompilationForDocument,
  listCompilationsForDocument,
  listDocuments,
  updateDocument,
  type CompilationStatus,
  type LatexCompilationRecord,
  type LatexDocumentRecord,
} from './latex-store'
import { enqueueCompilation } from './compile-queue'
import { compilationPdfPath, queueDepth } from './compile-queue'
import { existsSync } from 'node:fs'
import { resolveTectonicBin } from './tectonic'
import { defaultPaperSource } from './template'
export const MAX_SOURCE_LENGTH = 1_000_000
export const MAX_TITLE_LENGTH = 200

// A queued/running row can outlive a crashed server process; ignore such
// stale actives instead of locking the document out of compiling forever.
const ACTIVE_COMPILATION_FRESH_MS = 30 * 60 * 1000

export class LatexServiceError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function invalid(message: string): LatexServiceError {
  return new LatexServiceError(message, 400, 'invalid_request')
}

function notFound(message = 'latex document not found'): LatexServiceError {
  return new LatexServiceError(message, 404, 'not_found')
}

function requiredTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw invalid('title is required')
  if (title.length > MAX_TITLE_LENGTH) throw invalid(`title must be at most ${MAX_TITLE_LENGTH} characters`)
  return title
}

function requiredSource(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid('source must be a string')
  if (value.length > MAX_SOURCE_LENGTH) throw invalid(`source must be at most ${MAX_SOURCE_LENGTH} characters`)
  return value
}

function optionalProjectId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw invalid('project_id must be a string or null')
  return value.trim() || null
}

export function getEngineInfo(): { available: boolean; source: 'env' | 'path' | null; bin: string | null } {
  const resolved = resolveTectonicBin()
  return resolved
    ? { available: true, source: resolved.source, bin: resolved.bin }
    : { available: false, source: null, bin: null }
}

export function createLatexDocument(request: {
  title?: unknown
  source?: unknown
  project_id?: unknown
}): LatexDocumentRecord {
  return createDocument({
    title: requiredTitle(request.title),
    // A document created without a source starts from the template paper so
    // the "compile" acceptance path works out of the box.
    source: request.source === undefined ? defaultPaperSource() : requiredSource(request.source),
    project_id: optionalProjectId(request.project_id),
  })
}

export function updateLatexDocument(
  id: string,
  patch: { title?: unknown; source?: unknown; project_id?: unknown },
): LatexDocumentRecord {
  const next = updateDocument(id, {
    title: patch.title !== undefined ? requiredTitle(patch.title) : undefined,
    source: patch.source !== undefined ? requiredSource(patch.source) : undefined,
    project_id: optionalProjectId(patch.project_id),
  })
  if (!next) throw notFound()
  return next
}

export function getLatexDocument(id: string): LatexDocumentRecord {
  const doc = getDocument(id)
  if (!doc) throw notFound()
  return doc
}

export function listLatexDocuments(): LatexDocumentRecord[] {
  return listDocuments()
}

export function deleteLatexDocument(id: string): void {
  if (!deleteDocument(id)) throw notFound()
}

export function requestCompilation(documentId: string): LatexCompilationRecord {
  const doc = getDocument(documentId)
  if (!doc) throw notFound()
  if (!resolveTectonicBin()) {
    throw new LatexServiceError(
      'tectonic compiler is not configured; set TECTONIC_BIN or install tectonic in PATH',
      503,
      'engine_unavailable',
    )
  }
  const active = findActiveCompilationForDocument(documentId)
  if (active && Date.now() - active.updated_at <= ACTIVE_COMPILATION_FRESH_MS) {
    throw new LatexServiceError(
      'a compilation is already queued or running for this document',
      409,
      'compilation_in_progress',
    )
  }
  const record = createCompilation({ document_id: doc.id })
  enqueueCompilation(record.id)
  return record
}

function assertStatus(value: string): CompilationStatus {
  if (!(COMPILATION_STATUSES as readonly string[]).includes(value)) {
    throw invalid(`status must be one of: ${COMPILATION_STATUSES.join(', ')}`)
  }
  return value as CompilationStatus
}

export function listCompilations(documentId: string, status?: string): LatexCompilationRecord[] {
  getLatexDocument(documentId)
  const rows = listCompilationsForDocument(documentId)
  const filter = status ? assertStatus(status) : null
  return filter ? rows.filter(row => row.status === filter) : rows
}

export function getLatestCompilation(documentId: string): LatexCompilationRecord | null {
  getLatexDocument(documentId)
  return latestCompilationForDocument(documentId)
}

export function getLatexCompilation(compilationId: string): LatexCompilationRecord {
  const record = getCompilation(compilationId)
  if (!record) throw notFound('latex compilation not found')
  return record
}

export function getCompletedPdfPath(compilationId: string): string {
  const record = getLatexCompilation(compilationId)
  if (record.status !== 'completed') {
    throw new LatexServiceError('compilation has not produced a PDF yet', 409, 'compilation_not_completed')
  }
  const pdfPath = compilationPdfPath(compilationId)
  if (!existsSync(pdfPath)) {
    throw notFound('compiled PDF is no longer available')
  }
  return pdfPath
}

export function compilationQueueDepth(): number {
  return queueDepth()
}
