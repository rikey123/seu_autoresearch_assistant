// Knowledge base domain rules: collection CRUD, member management, the serial
// index/ask worker, and cited Q&A. Indexing and asking both run through the
// paper-qa sidecar subprocess — one task at a time — and every task that
// leaves the queued state ends in a terminal persisted state (completed or
// failed) with an operator-facing error instead of failing silently. The
// LLM/embedding endpoint is API-first: an OpenAI-compatible HTTP endpoint
// configured through environment variables; tasks fail fast with a clear
// error when OPENAI_API_KEY is missing.
import { existsSync } from 'fs'
import type { ChildProcess } from 'child_process'
import { killOwnedProcessTree } from '../../studio/public/process-tree'
import { getPaper } from '../library/paper-store'
import {
  closeRagDb,
  addCollectionMember,
  deleteCollection,
  getCollection,
  getCollectionMember,
  getCollectionPaperCount,
  getIndexJob,
  getLatestIndexJob,
  getQuestion,
  insertCollection,
  insertIndexJob,
  insertQuestion,
  listCollectionMembers,
  listCollectionQuestions,
  listCollections,
  nextQueuedIndexJob,
  nextQueuedQuestion,
  removeCollectionMember,
  updateCollection,
  updateIndexJob,
  updateQuestion,
  type CollectionListEntry,
  type RagCitation,
  type RagCollectionPatch,
  type RagCollectionRecord,
  type RagIndexJobRecord,
  type RagQuestionRecord,
} from './rag-store'
import {
  resolveSidecarLaunch,
  runSidecar,
  type RagSidecarPaper,
} from './rag-sidecar'

const DEFAULT_ENGINE = 'paper-qa'

export class RagServiceError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function invalid(message: string, status = 400): RagServiceError {
  return new RagServiceError(message, status)
}

function requiredString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} is required`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`${field} must be at most ${max} characters`)
  return trimmed
}

function optionalString(value: unknown, field: string, max = 2000): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw invalid(`${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`${field} must be at most ${max} characters`)
  return trimmed
}

// ---------------------------------------------------------------------------
// Collections and members
// ---------------------------------------------------------------------------

export function createCollection(input: { name?: unknown; description?: unknown }): RagCollectionRecord {
  const name = requiredString(input.name, 'name')
  const description = optionalString(input.description, 'description')
  return insertCollection({ name, description })
}

export function updateCollectionMetadata(
  id: string,
  patch: { name?: unknown; description?: unknown },
): RagCollectionRecord {
  const existing = getCollection(id)
  if (!existing) throw invalid('knowledge base collection not found', 404)
  const next: RagCollectionPatch = {}
  if (patch.name !== undefined) next.name = requiredString(patch.name, 'name')
  if (patch.description !== undefined) next.description = optionalString(patch.description, 'description')
  const updated = updateCollection(id, next)
  return updated as RagCollectionRecord
}

export function deleteCollectionCascade(id: string): void {
  const removed = deleteCollection(id)
  if (!removed) throw invalid('knowledge base collection not found', 404)
}

export function listCollectionView(): CollectionListEntry[] {
  return listCollections()
}

export interface CollectionMemberPaper {
  paper_id: string
  added_at: number
  title: string
  original_name: string
  file_exists: boolean
}

/** Members joined against the library paper records (same research domain). */
export function listCollectionMembersView(collectionId: string): CollectionMemberPaper[] {
  const collection = getCollection(collectionId)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  return listCollectionMembers(collectionId).map(member => {
    const paper = getPaper(member.paper_id)
    return {
      paper_id: member.paper_id,
      added_at: member.added_at,
      title: paper?.title ?? '',
      original_name: paper?.original_name ?? '',
      file_exists: paper ? existsSync(paper.file_path) : false,
    }
  })
}

export function getCollectionView(id: string): Record<string, unknown> {
  const collection = getCollection(id)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  return {
    collection,
    members: listCollectionMembersView(id),
    latest_index_job: getLatestIndexJob(id),
  }
}

/** Adding or removing members invalidates a built index ('indexed' → 'stale'). */
function markStaleIfIndexed(collectionId: string): void {
  const collection = getCollection(collectionId)
  if (!collection) return
  if (collection.index_status === 'indexed') {
    updateCollection(collectionId, { index_status: 'stale' })
  }
}

export function addMember(collectionId: string, paperId: unknown): CollectionMemberPaper {
  const collection = getCollection(collectionId)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  const id = requiredString(paperId, 'paperId')
  if (getCollectionMember(collectionId, id)) {
    throw invalid('paper is already a member of this collection', 409)
  }
  const paper = getPaper(id)
  if (!paper) throw invalid('paper not found in the library', 404)
  addCollectionMember(collectionId, id)
  markStaleIfIndexed(collectionId)
  return {
    paper_id: id,
    added_at: Date.now(),
    title: paper.title,
    original_name: paper.original_name,
    file_exists: existsSync(paper.file_path),
  }
}

export function removeMember(collectionId: string, paperId: string): void {
  const collection = getCollection(collectionId)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  const removed = removeCollectionMember(collectionId, paperId)
  if (!removed) throw invalid('paper is not a member of this collection', 404)
  markStaleIfIndexed(collectionId)
}

// ---------------------------------------------------------------------------
// Serial worker: index jobs and questions run one at a time, in submission
// order, through the shared sidecar subprocess lane.
// ---------------------------------------------------------------------------

interface QueueTask {
  kind: 'index' | 'ask'
  id: string
}

const pendingTasks: QueueTask[] = []
let draining = false
let workerStopped = false
let activeChild: ChildProcess | null = null
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  // Best-effort cleanup: never leave a sidecar child behind when the server
  // process exits while a task is running.
  process.once('exit', () => {
    try {
      activeChild?.kill('SIGKILL')
    } catch {
      // already gone
    }
  })
}

/** Test/shutdown hook: stop the worker and kill an in-flight sidecar child. */
export function stopRagWorker(): void {
  workerStopped = true
  if (activeChild?.pid) {
    killOwnedProcessTree(activeChild.pid, () => activeChild?.kill('SIGKILL'))
    activeChild = null
  }
  closeRagDb()
}

function enqueueTask(task: QueueTask): void {
  pendingTasks.push(task)
  void drain()
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (pendingTasks.length > 0 && !workerStopped) {
      const task = pendingTasks.shift()
      if (task === undefined) continue
      try {
        if (task.kind === 'index') await runIndexJob(task.id)
        else await runQuestionTask(task.id)
      } catch (error) {
        // A queue entry must never take the worker down; the persisted row
        // records the failure instead.
        markTaskFailed(task, `sidecar task crashed: ${(error as Error).message}`)
      }
    }
  } finally {
    draining = false
  }
}

function markTaskFailed(task: QueueTask, message: string): void {
  if (task.kind === 'index') {
    const job = getIndexJob(task.id)
    updateIndexJob(task.id, {
      status: 'failed',
      error: message,
      finished_at: Date.now(),
    })
    if (job) revertCollectionAfterFailedIndex(job.collection_id)
  } else {
    updateQuestion(task.id, {
      status: 'failed',
      error: message,
      finished_at: Date.now(),
    })
  }
}

/**
 * After a failed index attempt the collection goes back to a meaningful
 * state: never-indexed collections return to 'unindexed', collections with a
 * previous successful index become 'stale'.
 */
function revertCollectionAfterFailedIndex(collectionId: string): void {
  const collection = getCollection(collectionId)
  if (!collection || collection.index_status !== 'indexing') return
  updateCollection(collectionId, {
    index_status: collection.indexed_at == null ? 'unindexed' : 'stale',
  })
}

// ---------------------------------------------------------------------------
// Index pipeline
// ---------------------------------------------------------------------------

export function enqueueIndexJob(collectionId: string): { job: RagIndexJobRecord; collection: RagCollectionRecord } {
  const collection = getCollection(collectionId)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  if (collection.index_status === 'indexing') {
    throw invalid('an index job is already queued or running for this collection', 409)
  }
  const memberCount = getCollectionPaperCount(collectionId)
  if (memberCount === 0) {
    throw invalid('add at least one paper to the collection before indexing')
  }
  if (!resolveSidecarLaunch()) {
    throw invalid(
      'the RAG sidecar is not configured; set RAG_SIDECAR_BIN to a sidecar entrypoint that speaks the JSON stdin/stdout protocol',
      503,
    )
  }
  if (missingApiKey()) {
    throw invalid(missingApiKeyMessage(), 503)
  }
  const job = insertIndexJob({ collection_id: collectionId, papers_count: memberCount })
  updateCollection(collectionId, { index_status: 'indexing' })
  enqueueTask({ kind: 'index', id: job.id })
  return { job, collection: getCollection(collectionId) as RagCollectionRecord }
}

function sidecarPapers(collectionId: string): { papers: RagSidecarPaper[]; missing: string[] } {
  const papers: RagSidecarPaper[] = []
  const missing: string[] = []
  for (const member of listCollectionMembers(collectionId)) {
    const paper = getPaper(member.paper_id)
    if (!paper) {
      missing.push(member.paper_id)
      continue
    }
    if (!existsSync(paper.file_path)) {
      missing.push(paper.title || paper.original_name || member.paper_id)
      continue
    }
    papers.push({ id: paper.id, title: paper.title, path: paper.file_path })
  }
  return { papers, missing }
}

async function runIndexJob(jobId: string): Promise<void> {
  const job = getIndexJob(jobId)
  if (!job || job.status !== 'queued') return
  const startedAt = Date.now()
  updateIndexJob(jobId, {
    status: 'running',
    attempts: job.attempts + 1,
    started_at: startedAt,
    error: null,
  })

  const { papers, missing } = sidecarPapers(job.collection_id)
  if (papers.length === 0) {
    updateIndexJob(jobId, {
      status: 'failed',
      error: `no readable member PDFs: ${missing.join(', ') || 'collection is empty'}`,
      finished_at: Date.now(),
    })
    revertCollectionAfterFailedIndex(job.collection_id)
    return
  }
  updateIndexJob(jobId, { papers_count: papers.length })

  const outcome = await runSidecarTask({ action: 'index', papers })
  if (workerStopped) return

  if (!outcome.ok) {
    updateIndexJob(jobId, {
      status: 'failed',
      error: outcome.error,
      finished_at: Date.now(),
    })
    revertCollectionAfterFailedIndex(job.collection_id)
    return
  }
  const chunks = outcome.response?.chunks ?? 0
  updateIndexJob(jobId, {
    status: 'completed',
    chunks,
    engine: outcome.response?.engine || DEFAULT_ENGINE,
    finished_at: Date.now(),
  })
  updateCollection(job.collection_id, {
    index_status: 'indexed',
    chunks,
    engine: outcome.response?.engine || DEFAULT_ENGINE,
    indexed_at: Date.now(),
  })
}

// ---------------------------------------------------------------------------
// Ask pipeline (cited Q&A)
// ---------------------------------------------------------------------------

export function enqueueQuestion(collectionId: string, input: { question?: unknown }): RagQuestionRecord {
  const collection = getCollection(collectionId)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  if (collection.index_status === 'unindexed') {
    throw invalid('index the collection before asking questions')
  }
  if (collection.index_status === 'indexing') {
    throw invalid('wait for the index job to finish before asking questions', 409)
  }
  const question = requiredString(input.question, 'question', 4000)
  if (!resolveSidecarLaunch()) {
    throw invalid(
      'the RAG sidecar is not configured; set RAG_SIDECAR_BIN to a sidecar entrypoint that speaks the JSON stdin/stdout protocol',
      503,
    )
  }
  if (missingApiKey()) {
    throw invalid(missingApiKeyMessage(), 503)
  }
  const record = insertQuestion(collectionId, question)
  enqueueTask({ kind: 'ask', id: record.id })
  return record
}

async function runQuestionTask(questionId: string): Promise<void> {
  const record = getQuestion(questionId)
  if (!record || record.status !== 'queued') return
  updateQuestion(questionId, { status: 'running' })

  const { papers, missing } = sidecarPapers(record.collection_id)
  if (papers.length === 0) {
    updateQuestion(questionId, {
      status: 'failed',
      error: `no readable member PDFs: ${missing.join(', ') || 'collection is empty'}`,
      finished_at: Date.now(),
    })
    return
  }

  const outcome = await runSidecarTask({ action: 'ask', papers, question: record.question })
  if (workerStopped) return

  if (!outcome.ok) {
    updateQuestion(questionId, {
      status: 'failed',
      error: outcome.error,
      finished_at: Date.now(),
    })
    return
  }
  const answer = (outcome.response?.answer || '').trim()
  if (!answer) {
    updateQuestion(questionId, {
      status: 'failed',
      error: 'the sidecar reported success but returned no answer text',
      finished_at: Date.now(),
    })
    return
  }
  // Defense in depth: a citation must reference a paper this collection
  // actually contains. The sidecar is trusted for the answer text, but a
  // malformed or foreign paperId must never be persisted — unknown ids are
  // dropped instead of rendering broken traceability in the client.
  const memberIds = new Set(listCollectionMembers(record.collection_id).map(member => member.paper_id))
  const citations = (outcome.response?.citations ?? []).filter(citation => {
    const paperId = String(citation.paperId || '').trim()
    return paperId !== '' && memberIds.has(paperId)
  })
  updateQuestion(questionId, {
    status: 'answered',
    answer,
    citations,
    engine: outcome.response?.engine || DEFAULT_ENGINE,
    finished_at: Date.now(),
  })
}

// ---------------------------------------------------------------------------
// Sidecar execution
// ---------------------------------------------------------------------------

interface SidecarOutcome {
  ok: boolean
  response: import('./rag-sidecar').RagSidecarResponse | null
  error: string
}

function tailText(value: string, maxBytes = 8000): string {
  const text = value.trim()
  return text.length > maxBytes ? text.slice(-maxBytes) : text
}

async function runSidecarTask(request: {
  action: 'index' | 'ask'
  papers: RagSidecarPaper[]
  question?: string
}): Promise<SidecarOutcome> {
  const launch = resolveSidecarLaunch()
  if (!launch) {
    return {
      ok: false,
      response: null,
      error: 'the RAG sidecar is not configured; set RAG_SIDECAR_BIN to a sidecar entrypoint '
        + 'that speaks the JSON stdin/stdout protocol',
    }
  }
  installExitHook()
  const configuredTimeout = Number(process.env.RAG_SIDECAR_TIMEOUT_MS)
  const timeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : undefined
  const outcome = await runSidecar({
    request,
    bin: launch.bin,
    args: launch.args,
    timeoutMs,
    onSpawn: (child) => {
      activeChild = child
    },
  })
  activeChild = null
  if (workerStopped) {
    // The worker was stopped while the child ran (tests, shutdown): report a
    // neutral outcome; the caller leaves the persisted row untouched.
    return { ok: false, response: null, error: 'worker stopped' }
  }

  if (outcome.timedOut) {
    return {
      ok: false,
      response: null,
      error: `the RAG sidecar timed out after ${timeoutMs ?? 600000}ms and the process tree was killed`,
    }
  }
  if (!outcome.response) {
    return {
      ok: false,
      response: null,
      error: `the RAG sidecar produced no valid JSON response (exit code ${outcome.code}): `
        + tailText(outcome.stderr || outcome.stdout || 'no output'),
    }
  }
  if (outcome.response.status !== 'ok') {
    return {
      ok: false,
      response: outcome.response,
      error: outcome.response.error || `the RAG sidecar reported an error (exit code ${outcome.code})`,
    }
  }
  return { ok: true, response: outcome.response, error: '' }
}

// ---------------------------------------------------------------------------
// API-first gating
// ---------------------------------------------------------------------------

export function missingApiKey(): boolean {
  return !process.env.OPENAI_API_KEY?.trim()
}

export function missingApiKeyMessage(): string {
  return 'OPENAI_API_KEY is not configured in the server environment; set it to an '
    + 'OpenAI-compatible endpoint key together with OPENAI_BASE_URL/OPENAI_MODEL '
    + '(API-first only, no local models)'
}

// ---------------------------------------------------------------------------
// Queries for controllers
// ---------------------------------------------------------------------------

export function getQuestionView(questionId: string): RagQuestionRecord {
  const record = getQuestion(questionId)
  if (!record) throw invalid('question not found', 404)
  return record
}

export function getIndexJobView(jobId: string): RagIndexJobRecord {
  const job = getIndexJob(jobId)
  if (!job) throw invalid('index job not found', 404)
  return job
}

export function getHistoryView(collectionId: string): RagQuestionRecord[] {
  const collection = getCollection(collectionId)
  if (!collection) throw invalid('knowledge base collection not found', 404)
  return listCollectionQuestions(collectionId)
}
