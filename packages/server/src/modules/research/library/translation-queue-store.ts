// Research-owned SQLite persistence for pdf2zh translation jobs.
// Research is an isolated domain: it keeps its own database file under the Web
// UI home resolved through the Studio public config facade, following the same
// pattern as the artifacts registry store. The queue table intentionally lives
// in its own file so the library subdomain owns its state without reaching
// into the artifacts store.
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../../studio/public/config'

export const TRANSLATION_JOBS_TABLE = 'translation_jobs'

export const TRANSLATION_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export type TranslationJobStatus = (typeof TRANSLATION_JOB_STATUSES)[number]

export interface TranslationJobRecord {
  id: string
  pdf_path: string
  file_name: string
  target_lang: string
  service: string
  out_dir: string
  status: TranslationJobStatus
  attempts: number
  error: string | null
  mono_path: string | null
  dual_path: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export interface TranslationJobCreateInput {
  pdf_path: string
  file_name: string
  target_lang: string
  service: string
  out_dir: string
}

export interface TranslationJobPatch {
  status?: TranslationJobStatus
  attempts?: number
  error?: string | null
  mono_path?: string | null
  dual_path?: string | null
  started_at?: number | null
  finished_at?: number | null
}

interface TranslationJobRow {
  id: string
  pdf_path: string
  file_name: string
  target_lang: string
  service: string
  out_dir: string
  status: string
  attempts: number
  error: string | null
  mono_path: string | null
  dual_path: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

function queueDbDir(): string {
  return join(config.appHome, 'research')
}

function queueDbPath(): string {
  return join(queueDbDir(), 'translation-jobs.db')
}

let _db: DatabaseSync | null = null

export function getTranslationQueueDb(): DatabaseSync {
  if (!_db) {
    mkdirSync(queueDbDir(), { recursive: true })
    const db = new DatabaseSync(queueDbPath())
    db.exec('PRAGMA busy_timeout=5000')
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    db.exec(`CREATE TABLE IF NOT EXISTS ${TRANSLATION_JOBS_TABLE} (
      id TEXT PRIMARY KEY,
      pdf_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      target_lang TEXT NOT NULL DEFAULT 'zh',
      service TEXT NOT NULL DEFAULT 'openai',
      out_dir TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      mono_path TEXT,
      dual_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    )`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_translation_jobs_status ON ${TRANSLATION_JOBS_TABLE}(status)`)
    // A job cannot still be running when the queue database is opened by a
    // fresh process: any persisted "running" row is leftover from an
    // interrupted server run and is moved to failed with an explicit error.
    db.exec(`UPDATE ${TRANSLATION_JOBS_TABLE}
      SET status = 'failed',
          error = COALESCE(error, 'interrupted: server restarted while the job was running'),
          finished_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE status = 'running'`)
    _db = db
  }
  return _db
}

export function closeTranslationQueueDb(): void {
  if (_db) {
    try {
      _db.close()
    } catch {
      // best-effort shutdown
    }
    _db = null
  }
}

function nullableString(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value)
}

function rowToRecord(row: TranslationJobRow): TranslationJobRecord {
  return {
    id: String(row.id || ''),
    pdf_path: String(row.pdf_path || ''),
    file_name: String(row.file_name || ''),
    target_lang: String(row.target_lang || 'zh'),
    service: String(row.service || 'openai'),
    out_dir: String(row.out_dir || ''),
    status: String(row.status || 'queued') as TranslationJobStatus,
    attempts: Number(row.attempts || 0),
    error: nullableString(row.error),
    mono_path: nullableString(row.mono_path),
    dual_path: nullableString(row.dual_path),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
    started_at: nullableNumber(row.started_at),
    finished_at: nullableNumber(row.finished_at),
  }
}

export function insertTranslationJob(input: TranslationJobCreateInput): TranslationJobRecord {
  const now = Date.now()
  const record: TranslationJobRecord = {
    id: randomUUID(),
    pdf_path: input.pdf_path,
    file_name: input.file_name,
    target_lang: input.target_lang,
    service: input.service,
    out_dir: input.out_dir,
    status: 'queued',
    attempts: 0,
    error: null,
    mono_path: null,
    dual_path: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  }
  getTranslationQueueDb().prepare(`
    INSERT INTO ${TRANSLATION_JOBS_TABLE} (
      id, pdf_path, file_name, target_lang, service, out_dir,
      status, attempts, error, mono_path, dual_path,
      created_at, updated_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.pdf_path,
    record.file_name,
    record.target_lang,
    record.service,
    record.out_dir,
    record.status,
    record.attempts,
    record.error,
    record.mono_path,
    record.dual_path,
    record.created_at,
    record.updated_at,
    record.started_at,
    record.finished_at,
  )
  return record
}

export function getTranslationJobRow(id: string): TranslationJobRecord | null {
  const row = getTranslationQueueDb()
    .prepare(`SELECT * FROM ${TRANSLATION_JOBS_TABLE} WHERE id = ?`)
    .get(id) as TranslationJobRow | undefined
  return row ? rowToRecord(row) : null
}

export function listTranslationJobs(status?: TranslationJobStatus): TranslationJobRecord[] {
  const rows = status
    ? getTranslationQueueDb()
      .prepare(`SELECT * FROM ${TRANSLATION_JOBS_TABLE} WHERE status = ? ORDER BY created_at ASC, id ASC`)
      .all(status)
    : getTranslationQueueDb()
      .prepare(`SELECT * FROM ${TRANSLATION_JOBS_TABLE} ORDER BY created_at ASC, id ASC`)
      .all()
  return (rows as unknown as TranslationJobRow[]).map(rowToRecord)
}

/** Oldest queued job, or null when the queue is drained. */
export function nextQueuedTranslationJob(): TranslationJobRecord | null {
  const row = getTranslationQueueDb()
    .prepare(`SELECT * FROM ${TRANSLATION_JOBS_TABLE} WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`)
    .get() as TranslationJobRow | undefined
  return row ? rowToRecord(row) : null
}

const JOB_PATCH_COLUMNS: Record<keyof TranslationJobPatch, string> = {
  status: 'status',
  attempts: 'attempts',
  error: 'error',
  mono_path: 'mono_path',
  dual_path: 'dual_path',
  started_at: 'started_at',
  finished_at: 'finished_at',
}

export function updateTranslationJob(id: string, patch: TranslationJobPatch): TranslationJobRecord | null {
  const assignments: string[] = []
  const params: Array<string | number | null> = []
  for (const key of Object.keys(JOB_PATCH_COLUMNS) as Array<keyof TranslationJobPatch>) {
    if (patch[key] === undefined) continue
    assignments.push(`${JOB_PATCH_COLUMNS[key]} = ?`)
    params.push(patch[key] ?? null)
  }
  if (!assignments.length) return getTranslationJobRow(id)
  assignments.push('updated_at = ?')
  params.push(Date.now())
  params.push(id)
  getTranslationQueueDb()
    .prepare(`UPDATE ${TRANSLATION_JOBS_TABLE} SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params)
  return getTranslationJobRow(id)
}
