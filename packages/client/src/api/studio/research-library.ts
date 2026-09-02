import { getApiKey, request } from '../client'

export interface PaperRecord {
  id: string
  title: string
  original_name: string
  authors: string[]
  year: number | null
  venue: string
  tags: string[]
  file_size: number
  created_at: number
  updated_at: number
}

export async function listPapers(tag?: string): Promise<PaperRecord[]> {
  const path = tag
    ? `/api/studio/research/library/papers?tag=${encodeURIComponent(tag)}`
    : '/api/studio/research/library/papers'
  const res = await request<{ papers: PaperRecord[] }>(path)
  return res.papers
}

export async function uploadPaper(file: File): Promise<PaperRecord> {
  const form = new FormData()
  form.append('file', file)
  const res = await request<{ paper: PaperRecord }>('/api/studio/research/library/papers', {
    method: 'POST',
    body: form,
  })
  return res.paper
}

export async function deletePaper(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/studio/research/library/papers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// Token-free streaming endpoint path. Message bodies (chat transcripts,
// exports) must never persist an access token, so references baked into text
// use this form; previews and downloads inside the app still authenticate
// through the session (Authorization header via the request helper / router
// preview), and paperFileUrl() keeps the token variant for iframe streams
// where no header can be attached.
export function paperFilePath(id: string): string {
  return `/api/studio/research/library/papers/${encodeURIComponent(id)}/file`
}

// The streaming endpoint backs the native PDF viewer inside an iframe, where
// no Authorization header can be attached; the JWT middleware also accepts a
// token query parameter, mirroring the session export download URL.
export function paperFileUrl(id: string): string {
  const base = paperFilePath(id)
  const token = getApiKey()
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}
