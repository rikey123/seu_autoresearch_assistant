import { request } from '../client'
import { fetchAuthenticatedBlob } from './binary-content'

export type LatexCompilationStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface LatexEngineDiagnostic {
  file: string
  line: number | null
  message: string
}

export interface LatexDocumentMeta {
  id: string
  title: string
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface LatexDocument extends LatexDocumentMeta {
  source: string
}

export interface LatexCompilation {
  id: string
  document_id: string
  status: LatexCompilationStatus
  engine: string
  exit_code: number | null
  artifact_id: string | null
  errors: LatexEngineDiagnostic[]
  log: string
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

export interface LatexEngineInfo {
  available: boolean
  source: 'env' | 'path' | null
  bin: string | null
}

export async function listLatexDocuments(): Promise<LatexDocument[]> {
  const res = await request<{ documents: LatexDocument[] }>('/api/studio/research/latex/documents')
  return res.documents
}

export async function fetchLatexDocument(id: string): Promise<LatexDocument> {
  const res = await request<{ document: LatexDocument }>(
    `/api/studio/research/latex/documents/${encodeURIComponent(id)}`,
  )
  return res.document
}

export async function createLatexDocument(input: { title: string; source?: string }): Promise<LatexDocument> {
  const res = await request<{ document: LatexDocument }>('/api/studio/research/latex/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.document
}

export async function updateLatexDocument(
  id: string,
  patch: { title?: string; source?: string },
): Promise<LatexDocument> {
  const res = await request<{ document: LatexDocument }>(
    `/api/studio/research/latex/documents/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return res.document
}

export async function deleteLatexDocument(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/studio/research/latex/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function compileLatexDocument(id: string): Promise<LatexCompilation> {
  const res = await request<{ compilation: LatexCompilation }>(
    `/api/studio/research/latex/documents/${encodeURIComponent(id)}/compile`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  return res.compilation
}

export async function fetchLatestLatexCompilation(documentId: string): Promise<LatexCompilation | null> {
  const res = await request<{ compilation: LatexCompilation | null }>(
    `/api/studio/research/latex/documents/${encodeURIComponent(documentId)}/compilations/latest`,
  )
  return res.compilation
}

export async function fetchLatexEngineInfo(): Promise<LatexEngineInfo> {
  const res = await request<{ engine: LatexEngineInfo }>('/api/studio/research/latex/engine')
  return res.engine
}

export async function fetchLatexCompilationPdf(compilationId: string): Promise<ArrayBuffer> {
  const blob = await fetchAuthenticatedBlob(
    `/api/studio/research/latex/compilations/${encodeURIComponent(compilationId)}/pdf`,
  )
  return blob.arrayBuffer()
}
