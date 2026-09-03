import type { PaperRecord } from '@/api/studio/research-library'
import { paperFilePath } from '@/api/studio/research-library'
import type { ArtifactRecord } from '@/api/studio/research-artifacts'

// Build the chat message that carries a paper reference from the research
// workbench into a conversation. The send channel is the existing plain-text
// chat API, so the message is markdown text: title, metadata, and the paper's
// download URL as plain text (not a markdown link — the chat file-card pipeline
// only resolves workspace paths, and a relative link would render as a dead
// download card).
export function buildPaperChatMessage(paper: PaperRecord, fileUrl: string): string {
  const lines: string[] = [`📄 Paper: ${paper.title || paper.original_name}`]

  const meta = [
    paper.authors.length ? paper.authors.join(', ') : '',
    paper.year != null ? String(paper.year) : '',
    paper.venue,
  ].filter(Boolean).join(' · ')
  if (meta) lines.push(meta)

  if (paper.tags.length) {
    lines.push(paper.tags.map(tag => `#${tag}`).join(' '))
  }

  lines.push(`File: ${fileUrl}`)
  return lines.join('\n')
}

export function buildPaperChatMessageForId(paper: PaperRecord): string {
  // Token-free path: the message is persisted into the transcript, so the
  // access token must never be embedded in it. In-app preview/download is
  // still covered by the session (Authorization header / router preview).
  return buildPaperChatMessage(paper, paperFilePath(paper.id))
}

// Registry artifacts have no servable file yet (metadata-only registry, real
// preview payloads arrive with workflow render nodes), so the message carries
// the identity and preview metadata as plain text — no links, mirroring the
// paper rule that relative URLs would render as dead download cards.
export function buildArtifactChatMessage(artifact: ArtifactRecord): string {
  const lines: string[] = [`📄 Artifact: ${artifact.title}`]

  const meta = [
    artifact.type,
    `v${artifact.version}`,
    artifact.source_run_id ? `run: ${artifact.source_run_id}` : '',
  ].filter(Boolean).join(' · ')
  lines.push(meta)

  const previewEntries = Object.entries(artifact.preview || {})
  if (previewEntries.length) {
    const summary = previewEntries
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join('; ')
    lines.push(`Preview: ${summary}`)
  }
  return lines.join('\n')
}
