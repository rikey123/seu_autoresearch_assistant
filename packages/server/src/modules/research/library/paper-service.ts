// Validation and domain rules for the paper library.
import { randomUUID } from 'crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  PAPER_FILES_DIR,
  createPaper as persistPaper,
  deletePaper as removePaper,
  getPaper as findPaperById,
  getPaperByName as findPaperByName,
  listPapers as queryPapers,
  updatePaper as patchPaper,
  type PaperListFilter,
  type PaperRecord,
} from './paper-store'

const DEFAULT_MAX_PAPER_BYTES = 200 * 1024 * 1024

// Operators can raise or lower the cap for large-paper workflows via
// HERMES_MAX_PAPER_UPLOAD_SIZE (bytes). Read per request so tests can
// override it with vi.stubEnv.
export function getMaxPaperBytes(): number {
  const override = Number(process.env.HERMES_MAX_PAPER_UPLOAD_SIZE)
  if (Number.isFinite(override) && override > 0) return Math.floor(override)
  return DEFAULT_MAX_PAPER_BYTES
}

export interface PaperUploadInput {
  filename?: string
  data: Buffer
  title?: unknown
  authors?: unknown
  year?: unknown
  venue?: unknown
  tags?: unknown
}

export interface PaperMetadataPatch {
  title?: unknown
  authors?: unknown
  year?: unknown
  venue?: unknown
  tags?: unknown
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

function tooLarge(maxBytes: number): Error {
  return Object.assign(new Error(`paper PDF is too large (max ${maxBytes} bytes)`), { status: 413 })
}

function assertPdfUpload(filename: string | undefined, data: Buffer): void {
  const looksPdf = data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-'
  const extension = typeof filename === 'string' && filename.toLowerCase().endsWith('.pdf')
  if (!looksPdf || !extension) {
    throw invalid('file must be a PDF document')
  }
}

export function parseStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null || value === '') return []
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null
  if (!entries) throw invalid(`${field} must be a list or a comma-separated string`)
  return entries.map(entry => String(entry ?? '').trim()).filter(Boolean)
}

export function parseYear(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const year = Number(value)
  if (!Number.isSafeInteger(year)) throw invalid('year must be an integer')
  return year
}

function parseVenue(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw invalid('venue must be a string')
  return value.trim()
}

function resolveTitle(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return fallback
}

function requiredPatchTitle(value: unknown): string {
  const title = resolveTitle(value, '')
  if (!title) throw invalid('title must be a non-empty string')
  return title
}

export function uploadPaper(input: PaperUploadInput): PaperRecord {
  assertPdfUpload(input.filename, input.data)
  const maxBytes = getMaxPaperBytes()
  if (input.data.length > maxBytes) throw tooLarge(maxBytes)

  const originalName = (input.filename || 'paper.pdf').trim()
  const fallbackTitle = originalName.replace(/\.pdf$/i, '').trim() || 'paper'
  mkdirSync(PAPER_FILES_DIR, { recursive: true })
  const storedPath = join(PAPER_FILES_DIR, `${randomUUID()}.pdf`)
  writeFileSync(storedPath, input.data)

  try {
    return persistPaper({
      title: resolveTitle(input.title, fallbackTitle),
      original_name: originalName,
      authors: parseStringList(input.authors, 'authors'),
      year: parseYear(input.year),
      venue: parseVenue(input.venue),
      tags: parseStringList(input.tags, 'tags'),
      file_path: storedPath,
      file_size: input.data.length,
    })
  } catch (err) {
    try {
      unlinkSync(storedPath)
    } catch {
      // best-effort cleanup of the orphaned upload
    }
    throw err
  }
}

export function updatePaperMetadata(id: string, patch: PaperMetadataPatch): PaperRecord | null {
  return patchPaper(id, {
    title: patch.title === undefined ? undefined : requiredPatchTitle(patch.title),
    authors: patch.authors === undefined ? undefined : parseStringList(patch.authors, 'authors'),
    year: patch.year === undefined ? undefined : parseYear(patch.year),
    venue: patch.venue === undefined ? undefined : parseVenue(patch.venue),
    tags: patch.tags === undefined ? undefined : parseStringList(patch.tags, 'tags'),
  })
}

export function listPapers(filter: PaperListFilter = {}): PaperRecord[] {
  return queryPapers(filter)
}

export function getPaper(id: string): PaperRecord | null {
  return findPaperById(id)
}

export function getPaperByName(name: string): PaperRecord | null {
  return findPaperByName(name)
}

export function deletePaper(id: string): boolean {
  const removed = removePaper(id)
  if (!removed) return false
  try {
    unlinkSync(removed.file_path)
  } catch {
    // the PDF on disk may already be gone; the record is what matters
  }
  return true
}
