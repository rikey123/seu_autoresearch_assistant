// Research-owned SQLite persistence for the RAG knowledge base: collections,
// member papers, index jobs, and question history. Follows the papers.db /
// translation-jobs.db precedent: research keeps its own database file under
// the Web UI home resolved through the Studio public config facade. Member
// papers are references (paper ids) into the library subdomain's papers table,
// so a collection never duplicates paper metadata.
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../../studio/public/config'

export const COLLECTIONS_TABLE = 'rag_collections'
export const MEMBERS_TABLE = 'rag_collection_members'
export const INDEX_JOBS_TABLE = 'rag_index_jobs'
export const QUESTIONS_TABLE = 'rag_questions'

export const INDEX_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export type IndexJobStatus = (typeof INDEX_JOB_STATUSES)[number]

export const QUESTION_STATUSES = ['queued', 'running', 'answered', 'failed'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

// Collection-level index state shown in the UI. 'indexing' is a transient
// state owned by the index job lifecycle; 'stale' means an index exists but
// membership changed since it was built.
export const COLLECTION_INDEX_STATUSES = ['unindexed', 'indexing', 'indexed', 'stale'] as const
export type CollectionIndexStatus = (typeof COLLECTION_INDEX_STATUSES)[number]

export interface RagCollectionRecord {
  id: string
  name: string
  description: string
  index_status: CollectionIndexStatus
  chunks: number
  engine: string
  indexed_at: number | null
  created_at: number
  updated_at: number
}

export interface RagCollectionMemberRecord {
  collection_id: string
  paper_id: string
  added_at: number
}

export interface RagIndexJobRecord {
  id: string
  collection_id: string
  status: IndexJobStatus
  attempts: number
  papers_count: number
  chunks: number
  engine: string
  error: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export interface RagCitation {
  paperId: string
  page: number | null
  snippet: string
}

export interface RagQuestionRecord {
  id: string
  collection_id: string
  status: QuestionStatus
  question: string
  answer: string | null
  citations: RagCitation[]
  engine: string
  error: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

export interface RagCollectionCreateInput {
  name: string
  description?: string
}

export interface RagIndexJobCreateInput {
  collection_id: string
  papers_count: number
}

interface CollectionRow {
  id: string
  name: string
  description: string
  index_status: string
  chunks: number
  engine: string
  indexed_at: number | null
  created_at: number
  updated_at: number
}

interface MemberRow {
  collection_id: string
  paper_id: string
  added_at: number
}

interface IndexJobRow {
  id: string
  collection_id: string
  status: string
  attempts: number
  papers_count: number
  chunks: number
  engine: string
  error: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

interface QuestionRow {
  id: string
  collection_id: string
  status: string
  question: string
  answer: string | null
  citations_json: string
  engine: string
  error: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

const RESEARCH_DB_DIR = join(config.appHome, 'research')
const RAG_DB_PATH = join(RESEARCH_DB_DIR, 'rag.db')

let _db: DatabaseSync | null = null

function nullableString(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value)
}

function parseCitations(value: unknown): RagCitation[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): RagCitation[] => {
      if (!entry || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      const paperId = typeof record.paperId === 'string' ? record.paperId : ''
      if (!paperId) return []
      return [{
        paperId,
        page: typeof record.page === 'number' && Number.isSafeInteger(record.page) ? record.page : null,
        snippet: typeof record.snippet === 'string' ? record.snippet : '',
      }]
    })
  } catch {
    return []
  }
}

export function getRagDb(): DatabaseSync {
  if (!_db) {
    mkdirSync(RESEARCH_DB_DIR, { recursive: true })
    const db = new DatabaseSync(RAG_DB_PATH)
    db.exec('PRAGMA busy_timeout=5000')
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
    db.exec(`CREATE TABLE IF NOT EXISTS ${COLLECTIONS_TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      index_status TEXT NOT NULL DEFAULT 'unindexed',
      chunks INTEGER NOT NULL DEFAULT 0,
      engine TEXT NOT NULL DEFAULT '',
      indexed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS ${MEMBERS_TABLE} (
      collection_id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (collection_id, paper_id)
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS ${INDEX_JOBS_TABLE} (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      papers_count INTEGER NOT NULL DEFAULT 0,
      chunks INTEGER NOT NULL DEFAULT 0,
      engine TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS ${QUESTIONS_TABLE} (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      question TEXT NOT NULL,
      answer TEXT,
      citations_json TEXT NOT NULL DEFAULT '[]',
      engine TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    )`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rag_jobs_collection ON ${INDEX_JOBS_TABLE}(collection_id, created_at)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rag_questions_collection ON ${QUESTIONS_TABLE}(collection_id, created_at)`)
    // A task cannot still be running when the database is opened by a fresh
    // process: any persisted "running" row is leftover from an interrupted
    // server run and is moved to failed with an explicit error. Collections
    // left in the transient 'indexing' state fall back to 'stale'/'unindexed'
    // depending on whether an index had been built before.
    db.exec(`UPDATE ${INDEX_JOBS_TABLE}
      SET status = 'failed',
          error = COALESCE(error, 'interrupted: server restarted while the index job was running'),
          finished_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE status = 'running'`)
    db.exec(`UPDATE ${QUESTIONS_TABLE}
      SET status = 'failed',
          error = COALESCE(error, 'interrupted: server restarted while the question was running'),
          finished_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE status = 'running'`)
    db.exec(`UPDATE ${COLLECTIONS_TABLE}
      SET index_status = CASE WHEN indexed_at IS NULL THEN 'unindexed' ELSE 'stale' END,
          updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
      WHERE index_status = 'indexing'`)
    _db = db
  }
  return _db
}

export function closeRagDb(): void {
  if (_db) {
    try {
      _db.close()
    } catch {
      // best-effort shutdown
    }
    _db = null
  }
}

function rowToCollection(row: CollectionRow): RagCollectionRecord {
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    description: String(row.description || ''),
    index_status: String(row.index_status || 'unindexed') as CollectionIndexStatus,
    chunks: Number(row.chunks || 0),
    engine: String(row.engine || ''),
    indexed_at: nullableNumber(row.indexed_at),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  }
}

export function insertCollection(input: RagCollectionCreateInput): RagCollectionRecord {
  const now = Date.now()
  const record: RagCollectionRecord = {
    id: randomUUID(),
    name: input.name,
    description: input.description ?? '',
    index_status: 'unindexed',
    chunks: 0,
    engine: '',
    indexed_at: null,
    created_at: now,
    updated_at: now,
  }
  getRagDb().prepare(`
    INSERT INTO ${COLLECTIONS_TABLE} (
      id, name, description, index_status, chunks, engine, indexed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.name,
    record.description,
    record.index_status,
    record.chunks,
    record.engine,
    record.indexed_at,
    record.created_at,
    record.updated_at,
  )
  return record
}

export interface CollectionListEntry extends RagCollectionRecord {
  paper_count: number
}

export function listCollections(): CollectionListEntry[] {
  const rows = getRagDb().prepare(`
    SELECT c.*, (
      SELECT COUNT(*) FROM ${MEMBERS_TABLE} m WHERE m.collection_id = c.id
    ) AS paper_count
    FROM ${COLLECTIONS_TABLE} c
    ORDER BY c.created_at DESC, c.id ASC
  `).all() as unknown as Array<CollectionRow & { paper_count: number }>
  return rows.map(row => ({ ...rowToCollection(row), paper_count: Number(row.paper_count || 0) }))
}

export function getCollection(id: string): RagCollectionRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${COLLECTIONS_TABLE} WHERE id = ?`)
    .get(id) as CollectionRow | undefined
  return row ? rowToCollection(row) : null
}

export function getCollectionPaperCount(id: string): number {
  const row = getRagDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${MEMBERS_TABLE} WHERE collection_id = ?`)
    .get(id) as { n: number } | undefined
  return Number(row?.n || 0)
}

const COLLECTION_PATCH_COLUMNS = [
  'name',
  'description',
  'index_status',
  'chunks',
  'engine',
  'indexed_at',
] as const

export interface RagCollectionPatch {
  name?: string
  description?: string
  index_status?: CollectionIndexStatus
  chunks?: number
  engine?: string
  indexed_at?: number | null
}

export function updateCollection(id: string, patch: RagCollectionPatch): RagCollectionRecord | null {
  const assignments: string[] = []
  const params: Array<string | number | null> = []
  for (const column of COLLECTION_PATCH_COLUMNS) {
    const value = patch[column]
    if (value === undefined) continue
    assignments.push(`${column} = ?`)
    params.push(value ?? null)
  }
  if (!assignments.length) return getCollection(id)
  assignments.push('updated_at = ?')
  params.push(Date.now())
  params.push(id)
  getRagDb()
    .prepare(`UPDATE ${COLLECTIONS_TABLE} SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params)
  return getCollection(id)
}

export function deleteCollection(id: string): boolean {
  const existing = getCollection(id)
  if (!existing) return false
  const db = getRagDb()
  db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE collection_id = ?`).run(id)
  db.prepare(`DELETE FROM ${INDEX_JOBS_TABLE} WHERE collection_id = ?`).run(id)
  db.prepare(`DELETE FROM ${QUESTIONS_TABLE} WHERE collection_id = ?`).run(id)
  db.prepare(`DELETE FROM ${COLLECTIONS_TABLE} WHERE id = ?`).run(id)
  return true
}

export function addCollectionMember(collectionId: string, paperId: string): RagCollectionMemberRecord {
  const record: RagCollectionMemberRecord = {
    collection_id: collectionId,
    paper_id: paperId,
    added_at: Date.now(),
  }
  getRagDb().prepare(`
    INSERT OR IGNORE INTO ${MEMBERS_TABLE} (collection_id, paper_id, added_at)
    VALUES (?, ?, ?)
  `).run(record.collection_id, record.paper_id, record.added_at)
  return record
}

export function removeCollectionMember(collectionId: string, paperId: string): boolean {
  const result = getRagDb()
    .prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE collection_id = ? AND paper_id = ?`)
    .run(collectionId, paperId)
  return Number(result.changes) > 0
}

export function getCollectionMember(collectionId: string, paperId: string): RagCollectionMemberRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${MEMBERS_TABLE} WHERE collection_id = ? AND paper_id = ?`)
    .get(collectionId, paperId) as MemberRow | undefined
  return row
    ? { collection_id: String(row.collection_id), paper_id: String(row.paper_id), added_at: Number(row.added_at || 0) }
    : null
}

export function listCollectionMembers(collectionId: string): RagCollectionMemberRecord[] {
  const rows = getRagDb()
    .prepare(`SELECT * FROM ${MEMBERS_TABLE} WHERE collection_id = ? ORDER BY added_at ASC, paper_id ASC`)
    .all(collectionId) as unknown as MemberRow[]
  return rows.map(row => ({
    collection_id: String(row.collection_id),
    paper_id: String(row.paper_id),
    added_at: Number(row.added_at || 0),
  }))
}

export function insertIndexJob(input: RagIndexJobCreateInput): RagIndexJobRecord {
  const now = Date.now()
  const record: RagIndexJobRecord = {
    id: randomUUID(),
    collection_id: input.collection_id,
    status: 'queued',
    attempts: 0,
    papers_count: input.papers_count,
    chunks: 0,
    engine: '',
    error: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  }
  getRagDb().prepare(`
    INSERT INTO ${INDEX_JOBS_TABLE} (
      id, collection_id, status, attempts, papers_count, chunks, engine, error,
      created_at, updated_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.collection_id,
    record.status,
    record.attempts,
    record.papers_count,
    record.chunks,
    record.engine,
    record.error,
    record.created_at,
    record.updated_at,
    record.started_at,
    record.finished_at,
  )
  return record
}

export function getIndexJob(id: string): RagIndexJobRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${INDEX_JOBS_TABLE} WHERE id = ?`)
    .get(id) as IndexJobRow | undefined
  return row ? rowToIndexJob(row) : null
}

export function getLatestIndexJob(collectionId: string): RagIndexJobRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${INDEX_JOBS_TABLE} WHERE collection_id = ? ORDER BY created_at DESC, id ASC LIMIT 1`)
    .get(collectionId) as IndexJobRow | undefined
  return row ? rowToIndexJob(row) : null
}

function rowToIndexJob(row: IndexJobRow): RagIndexJobRecord {
  return {
    id: String(row.id || ''),
    collection_id: String(row.collection_id || ''),
    status: String(row.status || 'queued') as IndexJobStatus,
    attempts: Number(row.attempts || 0),
    papers_count: Number(row.papers_count || 0),
    chunks: Number(row.chunks || 0),
    engine: String(row.engine || ''),
    error: nullableString(row.error),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
    started_at: nullableNumber(row.started_at),
    finished_at: nullableNumber(row.finished_at),
  }
}

const INDEX_JOB_PATCH_COLUMNS: Record<keyof RagIndexJobPatch, string> = {
  status: 'status',
  attempts: 'attempts',
  papers_count: 'papers_count',
  chunks: 'chunks',
  engine: 'engine',
  error: 'error',
  started_at: 'started_at',
  finished_at: 'finished_at',
}

export interface RagIndexJobPatch {
  status?: IndexJobStatus
  attempts?: number
  papers_count?: number
  chunks?: number
  engine?: string
  error?: string | null
  started_at?: number | null
  finished_at?: number | null
}

export function updateIndexJob(id: string, patch: RagIndexJobPatch): RagIndexJobRecord | null {
  const assignments: string[] = []
  const params: Array<string | number | null> = []
  for (const key of Object.keys(INDEX_JOB_PATCH_COLUMNS) as Array<keyof RagIndexJobPatch>) {
    if (patch[key] === undefined) continue
    assignments.push(`${INDEX_JOB_PATCH_COLUMNS[key]} = ?`)
    params.push(patch[key] ?? null)
  }
  if (!assignments.length) return getIndexJob(id)
  assignments.push('updated_at = ?')
  params.push(Date.now())
  params.push(id)
  getRagDb()
    .prepare(`UPDATE ${INDEX_JOBS_TABLE} SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params)
  return getIndexJob(id)
}

/** Oldest queued index job, or null when the queue is drained. */
export function nextQueuedIndexJob(): RagIndexJobRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${INDEX_JOBS_TABLE} WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`)
    .get() as IndexJobRow | undefined
  return row ? rowToIndexJob(row) : null
}

export function insertQuestion(collectionId: string, question: string): RagQuestionRecord {
  const now = Date.now()
  const record: RagQuestionRecord = {
    id: randomUUID(),
    collection_id: collectionId,
    status: 'queued',
    question,
    answer: null,
    citations: [],
    engine: '',
    error: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  }
  getRagDb().prepare(`
    INSERT INTO ${QUESTIONS_TABLE} (
      id, collection_id, status, question, answer, citations_json, engine, error,
      created_at, updated_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.collection_id,
    record.status,
    record.question,
    record.answer,
    JSON.stringify(record.citations),
    record.engine,
    record.error,
    record.created_at,
    record.updated_at,
    record.finished_at,
  )
  return record
}

function rowToQuestion(row: QuestionRow): RagQuestionRecord {
  return {
    id: String(row.id || ''),
    collection_id: String(row.collection_id || ''),
    status: String(row.status || 'queued') as QuestionStatus,
    question: String(row.question || ''),
    answer: nullableString(row.answer),
    citations: parseCitations(row.citations_json),
    engine: String(row.engine || ''),
    error: nullableString(row.error),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
    finished_at: nullableNumber(row.finished_at),
  }
}

export function getQuestion(id: string): RagQuestionRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${QUESTIONS_TABLE} WHERE id = ?`)
    .get(id) as QuestionRow | undefined
  return row ? rowToQuestion(row) : null
}

export function listCollectionQuestions(collectionId: string): RagQuestionRecord[] {
  const rows = getRagDb()
    .prepare(`SELECT * FROM ${QUESTIONS_TABLE} WHERE collection_id = ? ORDER BY created_at DESC, id ASC`)
    .all(collectionId) as unknown as QuestionRow[]
  return rows.map(rowToQuestion)
}

/** Oldest queued question, or null when the queue is drained. */
export function nextQueuedQuestion(): RagQuestionRecord | null {
  const row = getRagDb()
    .prepare(`SELECT * FROM ${QUESTIONS_TABLE} WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`)
    .get() as QuestionRow | undefined
  return row ? rowToQuestion(row) : null
}

export interface RagQuestionPatch {
  status?: QuestionStatus
  answer?: string | null
  citations?: RagCitation[]
  engine?: string
  error?: string | null
  finished_at?: number | null
}

const QUESTION_PATCH_COLUMNS: Record<keyof RagQuestionPatch, string> = {
  status: 'status',
  answer: 'answer',
  citations: 'citations_json',
  engine: 'engine',
  error: 'error',
  finished_at: 'finished_at',
}

export function updateQuestion(id: string, patch: RagQuestionPatch): RagQuestionRecord | null {
  const assignments: string[] = []
  const params: Array<string | number | null> = []
  for (const key of Object.keys(QUESTION_PATCH_COLUMNS) as Array<keyof RagQuestionPatch>) {
    if (patch[key] === undefined) continue
    const value = key === 'citations' ? JSON.stringify(patch.citations ?? []) : patch[key]
    assignments.push(`${QUESTION_PATCH_COLUMNS[key]} = ?`)
    params.push(value ?? null)
  }
  if (!assignments.length) return getQuestion(id)
  assignments.push('updated_at = ?')
  params.push(Date.now())
  params.push(id)
  getRagDb()
    .prepare(`UPDATE ${QUESTIONS_TABLE} SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params)
  return getQuestion(id)
}
