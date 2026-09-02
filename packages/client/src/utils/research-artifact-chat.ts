import type { PaperRecord } from '@/api/studio/research-library'
import { paperFileUrl } from '@/api/studio/research-library'

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
  return buildPaperChatMessage(paper, paperFileUrl(paper.id))
}
