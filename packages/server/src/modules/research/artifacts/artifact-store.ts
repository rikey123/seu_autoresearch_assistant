// Research-owned SQLite persistence for the artifact registry.
// Research is an isolated domain: the boundary contract only allows Studio
// contracts/public facades, so this store keeps its own database file under
// the Web UI home resolved through the Studio public config facade.
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../../studio/public/config'

export const ARTIFACTS_TABLE = 'artifacts'

export const ARTIFACT_TYPES = ['html', 'svg', 'pptx', 'drawio', 'pdf', 'latex', 'figure'] as const
export type ArtifactType = (typeof ARTIFACT_TYPES)[number]

export interface ArtifactRecord {
  id: string
  project_id: string | null
  type: ArtifactType
  title: string
  version: number
  source_run_id: string | null
  preview: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface ArtifactCreateInput {
  type: ArtifactType
  title: string
  project_id?: string | null
  version?: number
  source_run_id?: string | null
  preview?: Record<string, unknown>
}

export interface ArtifactListFilter {
  type?: ArtifactType
  project_id?: string
}

interface ArtifactRow {
  id: string
  project_id: string | null
  type: string
  title: string
  version: number
  source_run_id: string | null
  preview_json: string
  created_at: number
  updated_at: number
}

const RESEARCH_DB_DIR = join(config.appHome, 'research')
const RESEARCH_DB_PATH = join(RESEARCH_DB_DIR, 'research.db')

let _db: DatabaseSync | null = null

export function getArtifactsDb(): DatabaseSync {
  if (!_db) {
    mkdirSync(RESEARCH_DB_DIR, { recursive: true })
    const db = new DatabaseSync(RESEARCH_DB_PATH)
    db.exec('PRAGMA busy_timeout=5000')
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    db.exec(`CREATE TABLE IF NOT EXISTS ${ARTIFACTS_TABLE} (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      source_run_id TEXT,
      preview_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_type ON ${ARTIFACTS_TABLE}(type)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_project ON ${ARTIFACTS_TABLE}(project_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_source_run ON ${ARTIFACTS_TABLE}(source_run_id)`)
    _db = db
  }
  return _db
}

export function closeArtifactsDb(): void {
  if (_db) {
    try {
      _db.close()
    } catch {
      // best-effort shutdown
    }
    _db = null
  }
}

function parseObjectJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function nullableString(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

function rowToRecord(row: ArtifactRow): ArtifactRecord {
  return {
    id: String(row.id || ''),
    project_id: nullableString(row.project_id),
    type: String(row.type || '') as ArtifactType,
    title: String(row.title || ''),
    version: Number(row.version || 1),
    source_run_id: nullableString(row.source_run_id),
    preview: parseObjectJson(row.preview_json),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }
}

export function createArtifact(input: ArtifactCreateInput): ArtifactRecord {
  const now = Date.now()
  const record: ArtifactRecord = {
    id: randomUUID(),
    project_id: input.project_id?.trim() || null,
    type: input.type,
    title: input.title.trim(),
    version: input.version ?? 1,
    source_run_id: input.source_run_id?.trim() || null,
    preview: input.preview ?? {},
    created_at: now,
    updated_at: now,
  }
  getArtifactsDb().prepare(`
    INSERT INTO ${ARTIFACTS_TABLE} (
      id, project_id, type, title, version, source_run_id, preview_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.project_id,
    record.type,
    record.title,
    record.version,
    record.source_run_id,
    JSON.stringify(record.preview),
    record.created_at,
    record.updated_at,
  )
  return record
}

export function listArtifacts(filter: ArtifactListFilter = {}): ArtifactRecord[] {
  const conditions: string[] = []
  const params: string[] = []
  if (filter.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter.project_id) {
    conditions.push('project_id = ?')
    params.push(filter.project_id)
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  const rows = getArtifactsDb()
    .prepare(`SELECT * FROM ${ARTIFACTS_TABLE}${where} ORDER BY updated_at DESC`)
    .all(...params)
  return (rows as unknown as ArtifactRow[]).map(rowToRecord)
}

export function getArtifact(id: string): ArtifactRecord | null {
  const row = getArtifactsDb()
    .prepare(`SELECT * FROM ${ARTIFACTS_TABLE} WHERE id = ?`)
    .get(id) as ArtifactRow | undefined
  return row ? rowToRecord(row) : null
}
