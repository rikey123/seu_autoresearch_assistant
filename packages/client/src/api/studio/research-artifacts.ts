import { request } from '../client'

// Client surface for the research artifact registry. The registry is
// metadata-only today: entries carry preview payloads as JSON (no file
// streaming, no Range), so the preview URL below resolves JSON through the
// authenticated request helper rather than an iframe-able file endpoint.
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

// The list endpoint supports type and project_id query params server-side;
// keyword filtering is not supported by the API and stays client-side.
export async function listArtifacts(type?: ArtifactType): Promise<ArtifactRecord[]> {
  const path = type
    ? `/api/studio/research/artifacts?type=${encodeURIComponent(type)}`
    : '/api/studio/research/artifacts'
  const res = await request<{ artifacts: ArtifactRecord[] }>(path)
  return res.artifacts
}

export async function getArtifact(id: string): Promise<ArtifactRecord> {
  const res = await request<{ artifact: ArtifactRecord }>(
    `/api/studio/research/artifacts/${encodeURIComponent(id)}`,
  )
  return res.artifact
}

export interface ArtifactPreviewPayload {
  id: string
  project_id: string | null
  type: ArtifactType
  title: string
  version: number
  source_run_id: string | null
  preview: Record<string, unknown>
  updated_at: number
}

export async function getArtifactPreview(id: string): Promise<ArtifactPreviewPayload> {
  const res = await request<{ preview: ArtifactPreviewPayload }>(
    `/api/studio/research/artifacts/${encodeURIComponent(id)}/preview`,
  )
  return res.preview
}

export function artifactPreviewPath(id: string): string {
  return `/api/studio/research/artifacts/${encodeURIComponent(id)}/preview`
}

export async function deleteArtifact(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/studio/research/artifacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
