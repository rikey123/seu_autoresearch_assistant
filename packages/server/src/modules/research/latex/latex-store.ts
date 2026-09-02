// Research-owned SQLite persistence for LaTeX documents and compilation runs.
// Mirrors the artifact-store pattern: research keeps its own database file
// under the Web UI home resolved through the Studio public config facade.
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../../studio/public/config'

export const DOCUMENTS_TABLE = 'latex_documents'
export const COMPILATIONS_TABLE = 'latex_compilations'

export type CompilationStatus = 'queued' | 'running' | 'completed' | 'failed'
export const COMPILATION_STATUSES: readonly CompilationStatus[] = ['queued', 'running', 'completed', 'failed']

export interface LatexDocumentRecord {
  id: string
  title: string
  source: string
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface LatexCompilationRecord {
  id: string
  document_id: string
  status: CompilationStatus
  engine: string
  exit_code: number | null
  artifact_id: string | null
  errors: Array<{ file: string; line: number | null; message: string }>
  log: string
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

interface CompilationRow {
  id: string
  document_id: string
  status: string
  engine: string | null
  exit_code: number | null
  artifact_id: string | null
  errors_json: string
  log: string
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

const RESEARCH_DB_DIR = join(config.appHome, 'research')
const LATEX_DB_PATH = join(RESEARCH_DB_DIR, 'latex.db')

let _db: DatabaseSync | null = null

export function getLatexDb(): DatabaseSync {
  if (!_db) {
    mkdirSync(RESEARCH_DB_DIR, { recursive: true })
    const db = new DatabaseSync(LATEX_DB_PATH)
    db.exec('PRAGMA busy_timeout=5000')
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    db.exec(`CREATE TABLE IF NOT EXISTS ${DOCUMENTS_TABLE} (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      project_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS ${COMPILATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      engine TEXT NOT NULL DEFAULT 'tectonic',
      exit_code INTEGER,
      artifact_id TEXT,
      errors_json TEXT NOT NULL DEFAULT '[]',
      log TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    )`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_latex_compilations_document ON ${COMPILATIONS_TABLE}(document_id)`)
    // A compilation cannot survive a server restart: any persisted non-final
    // row (queued or running) is leftover from an interrupted run and is moved
    // to failed with an explicit error, following the same startup
    // reconciliation as rag-store/translation-queue-store. Without this, a
    // hung "running" row would stay visible forever (the client freshness
    // window only avoided *new* compiles).
    db.exec(`UPDATE ${COMPILATIONS_TABLE}
      SET status = 'failed',
          errors_json = CASE WHEN errors_json IS NOT NULL AND errors_json <> '' AND errors_json <> '[]'
            THEN errors_json
            ELSE '[{"file":"","line":null,"message":"interrupted: server restarted while the compilation was running"}]'
          END,
          finished_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
          updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE status IN ('queued', 'running')`)
    _db = db
  }
  return _db
}

export function closeLatexDb(): void {
  if (_db) {
    try {
      _db.close()
    } catch {
      // best-effort shutdown
    }
    _db = null
  }
}

export function latexBuildsDir(): string {
  return join(RESEARCH_DB_DIR, 'latex', 'builds')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

export function createDocument(input: { title: string; source: string; project_id?: string | null }): LatexDocumentRecord {
  const now = Date.now()
  const record: LatexDocumentRecord = {
    id: randomUUID(),
    title: input.title,
    source: input.source,
    project_id: input.project_id?.trim() || null,
    created_at: now,
    updated_at: now,
  }
  getLatexDb().prepare(`
    INSERT INTO ${DOCUMENTS_TABLE} (id, title, source, project_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(record.id, record.title, record.source, record.project_id, record.created_at, record.updated_at)
  return record
}

export function updateDocument(
  id: string,
  patch: { title?: string; source?: string; project_id?: string | null },
): LatexDocumentRecord | null {
  const existing = getDocument(id)
  if (!existing) return null
  const next: LatexDocumentRecord = {
    ...existing,
    title: patch.title ?? existing.title,
    source: patch.source ?? existing.source,
    project_id: patch.project_id !== undefined ? (patch.project_id?.trim() || null) : existing.project_id,
    updated_at: Date.now(),
  }
  getLatexDb().prepare(`
    UPDATE ${DOCUMENTS_TABLE} SET title = ?, source = ?, project_id = ?, updated_at = ? WHERE id = ?
  `).run(next.title, next.source, next.project_id, next.updated_at, id)
  return next
}

export function getDocument(id: string): LatexDocumentRecord | null {
  const row = getLatexDb()
    .prepare(`SELECT * FROM ${DOCUMENTS_TABLE} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: text(row.id),
    title: text(row.title),
    source: text(row.source),
    project_id: row.project_id == null || row.project_id === '' ? null : text(row.project_id),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }
}

export function listDocuments(): LatexDocumentRecord[] {
  const rows = getLatexDb()
    .prepare(`SELECT * FROM ${DOCUMENTS_TABLE} ORDER BY updated_at DESC`)
    .all() as Array<Record<string, unknown>>
  return rows.map(row => ({
    id: text(row.id),
    title: text(row.title),
    source: text(row.source),
    project_id: row.project_id == null || row.project_id === '' ? null : text(row.project_id),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }))
}

export function deleteDocument(id: string): boolean {
  const result = getLatexDb()
    .prepare(`DELETE FROM ${DOCUMENTS_TABLE} WHERE id = ?`)
    .run(id)
  return Number(result.changes) > 0
}

export function createCompilation(input: {
  document_id: string
  engine?: string
}): LatexCompilationRecord {
  const now = Date.now()
  const record: LatexCompilationRecord = {
    id: randomUUID(),
    document_id: input.document_id,
    status: 'queued',
    engine: input.engine?.trim() || 'tectonic',
    exit_code: null,
    artifact_id: null,
    errors: [],
    log: '',
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  }
  getLatexDb().prepare(`
    INSERT INTO ${COMPILATIONS_TABLE} (
      id, document_id, status, engine, exit_code, artifact_id, errors_json, log,
      created_at, updated_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.document_id,
    record.status,
    record.engine,
    record.exit_code,
    record.artifact_id,
    JSON.stringify(record.errors),
    record.log,
    record.created_at,
    record.updated_at,
    record.started_at,
    record.finished_at,
  )
  return record
}

function rowToCompilation(row: CompilationRow): LatexCompilationRecord {
  let errors: LatexCompilationRecord['errors'] = []
  try {
    const parsed = JSON.parse(row.errors_json || '[]')
    if (Array.isArray(parsed)) {
      errors = parsed
        .filter((item): item is { file?: unknown; line?: unknown; message?: unknown } =>
          !!item && typeof item === 'object')
        .map(item => ({
          file: typeof item.file === 'string' ? item.file : '',
          line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : null,
          message: typeof item.message === 'string' ? item.message : '',
        }))
    }
  } catch {
    errors = []
  }
  return {
    id: String(row.id || ''),
    document_id: String(row.document_id || ''),
    status: (COMPILATION_STATUSES as readonly string[]).includes(row.status)
      ? row.status as CompilationStatus
      : 'failed',
    engine: String(row.engine || 'tectonic'),
    exit_code: row.exit_code == null ? null : Number(row.exit_code),
    artifact_id: row.artifact_id == null ? null : String(row.artifact_id),
    errors,
    log: String(row.log || ''),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
    started_at: row.started_at == null ? null : Number(row.started_at),
    finished_at: row.finished_at == null ? null : Number(row.finished_at),
  }
}

export function getCompilation(id: string): LatexCompilationRecord | null {
  const row = getLatexDb()
    .prepare(`SELECT * FROM ${COMPILATIONS_TABLE} WHERE id = ?`)
    .get(id) as CompilationRow | undefined
  return row ? rowToCompilation(row) : null
}

export function latestCompilationForDocument(documentId: string): LatexCompilationRecord | null {
  const row = getLatexDb()
    .prepare(`SELECT * FROM ${COMPILATIONS_TABLE} WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(documentId) as CompilationRow | undefined
  return row ? rowToCompilation(row) : null
}

export function listCompilationsForDocument(documentId: string, limit = 20): LatexCompilationRecord[] {
  const rows = getLatexDb()
    .prepare(`SELECT * FROM ${COMPILATIONS_TABLE} WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(documentId, limit) as unknown as CompilationRow[]
  return rows.map(rowToCompilation)
}

export function findActiveCompilationForDocument(documentId: string): LatexCompilationRecord | null {
  const row = getLatexDb()
    .prepare(`SELECT * FROM ${COMPILATIONS_TABLE} WHERE document_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`)
    .get(documentId) as CompilationRow | undefined
  return row ? rowToCompilation(row) : null
}

export function updateCompilation(
  id: string,
  patch: Partial<Pick<LatexCompilationRecord,
    'status' | 'exit_code' | 'artifact_id' | 'errors' | 'log' | 'started_at' | 'finished_at'>>,
): LatexCompilationRecord | null {
  const existing = getCompilation(id)
  if (!existing) return null
  const next: LatexCompilationRecord = {
    ...existing,
    status: patch.status ?? existing.status,
    exit_code: patch.exit_code !== undefined ? patch.exit_code : existing.exit_code,
    artifact_id: patch.artifact_id !== undefined ? patch.artifact_id : existing.artifact_id,
    errors: patch.errors ?? existing.errors,
    log: patch.log !== undefined ? patch.log : existing.log,
    started_at: patch.started_at !== undefined ? patch.started_at : existing.started_at,
    finished_at: patch.finished_at !== undefined ? patch.finished_at : existing.finished_at,
    updated_at: Date.now(),
  }
  getLatexDb().prepare(`
    UPDATE ${COMPILATIONS_TABLE} SET
      status = ?, exit_code = ?, artifact_id = ?, errors_json = ?, log = ?,
      started_at = ?, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.status,
    next.exit_code,
    next.artifact_id,
    JSON.stringify(next.errors),
    next.log,
    next.started_at,
    next.finished_at,
    next.updated_at,
    id,
  )
  return next
}
