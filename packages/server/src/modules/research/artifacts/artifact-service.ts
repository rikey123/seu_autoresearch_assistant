// Validation and domain rules for the artifact registry.
import {
  ARTIFACT_TYPES,
  createArtifact as persistArtifact,
  deleteArtifact as removeArtifactById,
  getArtifact as findArtifactById,
  listArtifacts as queryArtifacts,
  type ArtifactListFilter,
  type ArtifactRecord,
  type ArtifactType,
} from './artifact-store'

export interface ArtifactCreateRequest {
  type?: unknown
  title?: unknown
  project_id?: unknown
  version?: unknown
  source_run_id?: unknown
  preview?: unknown
}

export interface ArtifactQuery {
  type?: string
  project_id?: string
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

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(value)
}

function requiredType(value: unknown): ArtifactType {
  if (!isArtifactType(value)) {
    throw invalid(`type must be one of: ${ARTIFACT_TYPES.join(', ')}`)
  }
  return value
}

function optionalNullableString(value: unknown, name: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw invalid(`${name} must be a string or null`)
  return value.trim() || null
}

export function registerArtifact(request: ArtifactCreateRequest): ArtifactRecord {
  const type = requiredType(request.type)
  const title = typeof request.title === 'string' ? request.title.trim() : ''
  if (!title) throw invalid('title is required')
  let version = 1
  if (request.version !== undefined && request.version !== null) {
    if (typeof request.version !== 'number' || !Number.isSafeInteger(request.version) || request.version < 1) {
      throw invalid('version must be a positive integer')
    }
    version = request.version
  }
  const preview = request.preview ?? {}
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    throw invalid('preview must be an object')
  }
  return persistArtifact({
    type,
    title,
    version,
    project_id: optionalNullableString(request.project_id, 'project_id'),
    source_run_id: optionalNullableString(request.source_run_id, 'source_run_id'),
    preview: preview as Record<string, unknown>,
  })
}

export function listArtifacts(query: ArtifactQuery = {}): ArtifactRecord[] {
  const filter: ArtifactListFilter = {}
  if (query.type) filter.type = requiredType(query.type)
  if (query.project_id) filter.project_id = query.project_id
  return queryArtifacts(filter)
}

export function getArtifact(id: string): ArtifactRecord | null {
  return findArtifactById(id)
}

export function getArtifactPreview(id: string): ArtifactPreviewPayload | null {
  const artifact = findArtifactById(id)
  if (!artifact) return null
  return {
    id: artifact.id,
    project_id: artifact.project_id,
    type: artifact.type,
    title: artifact.title,
    version: artifact.version,
    source_run_id: artifact.source_run_id,
    preview: artifact.preview,
    updated_at: artifact.updated_at,
  }
}

// Deleting a registry entry removes the metadata row only: the artifacts store
// owns no files (compiled PDFs stay servable through the latex module, run
// files through the workflow proxy).
export function deleteArtifact(id: string): boolean {
  return removeArtifactById(id) !== null
}
