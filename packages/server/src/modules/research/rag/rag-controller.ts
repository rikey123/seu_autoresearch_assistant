// HTTP handlers for the RAG knowledge base endpoints: collection CRUD,
// membership, index jobs, cited questions, and per-collection history.
import type { Context } from 'koa'
import {
  RagServiceError,
  addMember,
  createCollection,
  deleteCollectionCascade,
  enqueueIndexJob,
  enqueueQuestion,
  getCollectionView,
  getHistoryView,
  getIndexJobView,
  getQuestionView,
  listCollectionView,
  listCollectionMembersView,
  removeMember,
  updateCollectionMetadata,
} from './rag-service'

function bodyRecord(ctx: Context): Record<string, unknown> {
  const body = ctx.request.body
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
}

function requiredId(ctx: Context, kind: 'collection' | 'paperId'): string | null {
  const param = kind === 'collection' ? ctx.params?.id : ctx.params?.paperId
  const id = typeof param === 'string' ? param.trim() : ''
  if (id) return id
  ctx.status = 400
  ctx.body = { error: kind === 'collection' ? 'collection id is required' : 'paper id is required' }
  return null
}

function respondError(ctx: Context, err: unknown): void {
  const error = err as RagServiceError
  ctx.status = typeof error?.status === 'number' ? error.status : 400
  ctx.body = { error: error?.message || 'invalid knowledge base request' }
}

export async function create(ctx: Context) {
  try {
    const collection = createCollection(bodyRecord(ctx))
    ctx.status = 201
    ctx.body = { collection }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function list(ctx: Context) {
  ctx.body = { collections: listCollectionView() }
}

export async function get(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    ctx.body = getCollectionView(id)
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function update(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    ctx.body = { collection: updateCollectionMetadata(id, bodyRecord(ctx)) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function remove(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    deleteCollectionCascade(id)
    ctx.body = { ok: true }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function listMembers(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    ctx.body = { members: listCollectionMembersView(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function addPaper(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    const member = addMember(id, bodyRecord(ctx).paperId)
    ctx.status = 201
    ctx.body = { member }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function removePaper(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  const paperId = requiredId(ctx, 'paperId')
  if (!id || !paperId) return
  try {
    removeMember(id, paperId)
    ctx.body = { ok: true }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function index(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    const { job } = enqueueIndexJob(id)
    ctx.status = 202
    ctx.body = { job }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function latestIndexJob(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    const view = getCollectionView(id)
    ctx.body = { latest_index_job: view.latest_index_job, collection: view.collection }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function ask(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    const question = enqueueQuestion(id, bodyRecord(ctx))
    ctx.status = 202
    ctx.body = { question }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function history(ctx: Context) {
  const id = requiredId(ctx, 'collection')
  if (!id) return
  try {
    ctx.body = { history: getHistoryView(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function questionStatus(ctx: Context) {
  const id = typeof ctx.params?.questionId === 'string' ? ctx.params.questionId.trim() : ''
  if (!id) {
    ctx.status = 400
    ctx.body = { error: 'question id is required' }
    return
  }
  try {
    ctx.body = { question: getQuestionView(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}

export async function indexJobStatus(ctx: Context) {
  const id = typeof ctx.params?.jobId === 'string' ? ctx.params.jobId.trim() : ''
  if (!id) {
    ctx.status = 400
    ctx.body = { error: 'index job id is required' }
    return
  }
  try {
    ctx.body = { job: getIndexJobView(id) }
  } catch (err) {
    respondError(ctx, err)
  }
}
