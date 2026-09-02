import { request } from '../client'

export type RagIndexStatus = 'unindexed' | 'indexing' | 'indexed' | 'stale'
export type RagJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type RagQuestionStatus = 'queued' | 'running' | 'answered' | 'failed'

export interface RagCollection {
  id: string
  name: string
  description: string
  index_status: RagIndexStatus
  chunks: number
  engine: string
  indexed_at: number | null
  created_at: number
  updated_at: number
  paper_count?: number
}

export interface RagCollectionMember {
  paper_id: string
  added_at: number
  title: string
  original_name: string
  file_exists: boolean
}

export interface RagIndexJob {
  id: string
  collection_id: string
  status: RagJobStatus
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

export interface RagQuestion {
  id: string
  collection_id: string
  status: RagQuestionStatus
  question: string
  answer: string | null
  citations: RagCitation[]
  engine: string
  error: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

export async function listCollections(): Promise<RagCollection[]> {
  const res = await request<{ collections: RagCollection[] }>('/api/studio/research/rag/collections')
  return res.collections
}

export async function createCollection(name: string, description: string): Promise<RagCollection> {
  const res = await request<{ collection: RagCollection }>('/api/studio/research/rag/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
  return res.collection
}

export async function updateCollection(id: string, patch: { name?: string; description?: string }): Promise<RagCollection> {
  const res = await request<{ collection: RagCollection }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  return res.collection
}

export async function deleteCollection(id: string): Promise<void> {
  await request(`/api/studio/research/rag/collections/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listMembers(id: string): Promise<RagCollectionMember[]> {
  const res = await request<{ members: RagCollectionMember[] }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/papers`,
  )
  return res.members
}

export async function addMember(id: string, paperId: string): Promise<RagCollectionMember> {
  const res = await request<{ member: RagCollectionMember }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/papers`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperId }),
    },
  )
  return res.member
}

export async function removeMember(id: string, paperId: string): Promise<void> {
  await request(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/papers/${encodeURIComponent(paperId)}`,
    { method: 'DELETE' },
  )
}

export async function startIndexing(id: string): Promise<RagIndexJob> {
  const res = await request<{ job: RagIndexJob }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/index`,
    { method: 'POST' },
  )
  return res.job
}

export async function getLatestIndexJob(id: string): Promise<RagIndexJob | null> {
  const res = await request<{ latest_index_job: RagIndexJob | null }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/index`,
  )
  return res.latest_index_job
}

export async function askQuestion(id: string, question: string): Promise<RagQuestion> {
  const res = await request<{ question: RagQuestion }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/ask`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    },
  )
  return res.question
}

export async function getQuestion(questionId: string): Promise<RagQuestion> {
  const res = await request<{ question: RagQuestion }>(
    `/api/studio/research/rag/questions/${encodeURIComponent(questionId)}`,
  )
  return res.question
}

export async function getHistory(id: string): Promise<RagQuestion[]> {
  const res = await request<{ history: RagQuestion[] }>(
    `/api/studio/research/rag/collections/${encodeURIComponent(id)}/history`,
  )
  return res.history
}
