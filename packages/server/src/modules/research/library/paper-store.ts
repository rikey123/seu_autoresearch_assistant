// Research-owned SQLite persistence for the paper library.
// Research is an isolated domain: it may only touch Studio public facades, so
// the papers table lives in its own database file under the Web UI home
// resolved through the Studio public config facade. The schema constants and
// the additive-only migration (create the missing table, append safe missing
// columns, never drop or rebuild) follow the studio schemas.ts precedent.
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../../studio/public/config'

export const PAPERS_TABLE = 'papers'

export const PAPERS_SCHEMA: Record<string, string> = {
  id: 'TEXT PRIMARY KEY',
  title: 'TEXT NOT NULL',
  original_name: "TEXT NOT NULL DEFAULT ''",
  authors: "TEXT NOT NULL DEFAULT '[]'",
  year: 'INTEGER',
  venue: "TEXT NOT NULL DEFAULT ''",
  tags: "TEXT NOT NULL DEFAULT '[]'",
  file_path: 'TEXT NOT NULL',
  file_size: 'INTEGER NOT NULL DEFAULT 0',
  created_at: 'INTEGER NOT NULL',
  updated_at: 'INTEGER NOT NULL',
}

export const PAPERS_INDEXES = {
  idx_papers_created_at: `CREATE INDEX IF NOT EXISTS idx_papers_created_at ON ${PAPERS_TABLE}(created_at)`,
}

export interface PaperRecord {
  id: string
  title: string
  original_name: string
  authors: string[]
  year: number | null
  venue: string
  tags: string[]
  file_path: string
  file_size: number
  created_at: number
  updated_at: number
}

export interface PaperCreateInput {
  title: string
  original_name?: string
  authors?: string[]
  year?: number | null
  venue?: string
  tags?: string[]
  file_path: string
  file_size?: number
}

export interface PaperUpdateInput {
  title?: string
  authors?: string[]
  year?: number | null
  venue?: string
  tags?: string[]
}

export interface PaperListFilter {
  tag?: string
}

interface PaperRow {
  id: string
  title: string
  original_name: string
  authors: string
  year: number | null
  venue: string
  tags: string
  file_path: string
  file_size: number
  created_at: number
  updated_at: number
}

const RESEARCH_DB_DIR = join(config.appHome, 'research')
const PAPERS_DB_PATH = join(RESEARCH_DB_DIR, 'papers.db')

// Uploaded PDF bytes are stored outside the database, mirroring how the media
// endpoints keep generated files under the app home.
export const PAPER_FILES_DIR = join(RESEARCH_DB_DIR, 'papers')

let _db: DatabaseSync | null = null

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
  ).get(tableName))
}

function createTable(db: DatabaseSync, tableName: string, schema: Record<string, string>): void {
  const colDefs = Object.entries(schema).map(([col, def]) => `${quoteIdentifier(col)} ${def}`)
  db.exec(`CREATE TABLE ${quoteIdentifier(tableName)} (${colDefs.join(', ')})`)
}

function canAddColumnToExistingTable(schemaDef: string): boolean {
  const normalized = schemaDef.toUpperCase()
  if (normalized.includes('PRIMARY KEY')) return false
  if (normalized.includes('NOT NULL') && !normalized.includes('DEFAULT')) return false
  return true
}

function addMissingSafeColumns(db: DatabaseSync, tableName: string, schema: Record<string, string>): void {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>
  const existingColumns = new Set(columns.map(col => col.name))
  for (const [columnName, columnDef] of Object.entries(schema)) {
    if (existingColumns.has(columnName)) continue
    if (!canAddColumnToExistingTable(columnDef)) {
      console.warn(`[Schema] ${tableName}.${columnName} cannot be added safely to existing table; skipping`)
      continue
    }
    db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnDef}`)
  }
}

function createIndexes(db: DatabaseSync, indexes: Record<string, string>): void {
  for (const indexSQL of Object.values(indexes)) {
    db.exec(indexSQL)
  }
}

export function getPapersDb(): DatabaseSync {
  if (!_db) {
    mkdirSync(RESEARCH_DB_DIR, { recursive: true })
    const db = new DatabaseSync(PAPERS_DB_PATH)
    db.exec('PRAGMA busy_timeout=5000')
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    if (!tableExists(db, PAPERS_TABLE)) {
      createTable(db, PAPERS_TABLE, PAPERS_SCHEMA)
    } else {
      addMissingSafeColumns(db, PAPERS_TABLE, PAPERS_SCHEMA)
    }
    createIndexes(db, PAPERS_INDEXES)
    _db = db
  }
  return _db
}

export function closePapersDb(): void {
  if (_db) {
    try {
      _db.close()
    } catch {
      // best-effort shutdown
    }
    _db = null
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map(entry => String(entry ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function rowToRecord(row: PaperRow): PaperRecord {
  return {
    id: String(row.id || ''),
    title: String(row.title || ''),
    original_name: String(row.original_name || ''),
    authors: parseStringArray(row.authors),
    year: row.year == null ? null : Number(row.year),
    venue: String(row.venue || ''),
    tags: parseStringArray(row.tags),
    file_path: String(row.file_path || ''),
    file_size: Number(row.file_size || 0),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }
}

export function createPaper(input: PaperCreateInput): PaperRecord {
  const now = Date.now()
  const record: PaperRecord = {
    id: randomUUID(),
    title: input.title,
    original_name: input.original_name ?? '',
    authors: input.authors ?? [],
    year: input.year ?? null,
    venue: input.venue ?? '',
    tags: input.tags ?? [],
    file_path: input.file_path,
    file_size: input.file_size ?? 0,
    created_at: now,
    updated_at: now,
  }
  getPapersDb().prepare(`
    INSERT INTO ${PAPERS_TABLE} (
      id, title, original_name, authors, year, venue, tags, file_path, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.title,
    record.original_name,
    JSON.stringify(record.authors),
    record.year,
    record.venue,
    JSON.stringify(record.tags),
    record.file_path,
    record.file_size,
    record.created_at,
    record.updated_at,
  )
  return record
}

export function listPapers(filter: PaperListFilter = {}): PaperRecord[] {
  const rows = getPapersDb()
    .prepare(`SELECT * FROM ${PAPERS_TABLE} ORDER BY created_at DESC`)
    .all() as unknown as PaperRow[]
  const records = (rows).map(rowToRecord)
  if (!filter.tag) return records
  return records.filter(record => record.tags.includes(filter.tag as string))
}

export function getPaper(id: string): PaperRecord | null {
  const row = getPapersDb()
    .prepare(`SELECT * FROM ${PAPERS_TABLE} WHERE id = ?`)
    .get(id) as PaperRow | undefined
  return row ? rowToRecord(row) : null
}

export function getPaperByName(name: string): PaperRecord | null {
  const row = getPapersDb()
    .prepare(`SELECT * FROM ${PAPERS_TABLE} WHERE original_name = ? ORDER BY created_at DESC`)
    .get(name) as PaperRow | undefined
  return row ? rowToRecord(row) : null
}

export function updatePaper(id: string, patch: PaperUpdateInput): PaperRecord | null {
  const existing = getPaper(id)
  if (!existing) return null
  const next: PaperRecord = {
    ...existing,
    title: patch.title ?? existing.title,
    authors: patch.authors ?? existing.authors,
    year: patch.year === undefined ? existing.year : patch.year,
    venue: patch.venue ?? existing.venue,
    tags: patch.tags ?? existing.tags,
  }
  getPapersDb().prepare(`
    UPDATE ${PAPERS_TABLE}
    SET title = ?, authors = ?, year = ?, venue = ?, tags = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.title,
    JSON.stringify(next.authors),
    next.year,
    next.venue,
    JSON.stringify(next.tags),
    Date.now(),
    id,
  )
  return getPaper(id)
}

export function deletePaper(id: string): PaperRecord | null {
  const existing = getPaper(id)
  if (!existing) return null
  getPapersDb().prepare(`DELETE FROM ${PAPERS_TABLE} WHERE id = ?`).run(id)
  return existing
}
