// Server-side proxy for research run artifacts (PDFs). The pt-bilingual
// template used to embed workspace PDFs with file:/// iframes, which every
// browser blocks once the comparison page is opened from an http origin.
// This service streams the same files over HTTP with single-range semantics,
// so the generated page works from file:// AND http:// origins alike.
//
// Security model (path confinement): the client supplies an absolute path,
// but the allowed root set is always computed server side and never trusted
// from the request:
//   1. config.appHome/research (research-owned state directory);
//   2. every registered workflow's run workspace directory (the engine passes
//      the workspace as the script node cwd, so run artifacts land there).
// The requested path is normalized, checked for lexical traversal, resolved
// through realpath (symlink escape), re-checked against the realpath'd roots
// (case-insensitively on Windows), and must be a regular PDF file. Anything
// else is rejected with 403 (policy) or 404 (not found).
import { createReadStream, realpathSync, statSync } from 'fs'
import { basename, extname, isAbsolute, join, normalize, parse, sep } from 'path'
import { config } from '../../studio/public/config'
import { listWorkflows } from '../../studio/public/workflows'

/** Only PDFs are proxied: the bilingual page embeds PDFs exclusively, and an
 * inline PDF-only policy removes any stored-XHS/HTML-reflection surface (the
 * URL carries the user's auth token as a query parameter). */
const ALLOWED_EXTENSION = '.pdf'

export class RunFileProxyError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface OpenRunFileStream {
  status: 200 | 206
  stream: ReturnType<typeof createReadStream>
  start: number
  end: number
  size: number
  fileName: string
}

/** Windows path containment is case-insensitive (NTFS), including the drive
 * letter; other platforms compare byte-for-byte. */
function comparablePath(value: string): string {
  const normalized = normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function containsPath(root: string, candidate: string): boolean {
  const comparableRoot = comparablePath(root)
  const comparableCandidate = comparablePath(candidate)
  if (comparableCandidate === comparableRoot) return false // directories are not served
  const rooted = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep.toLowerCase()
  return comparableCandidate.startsWith(rooted)
}

/** Reject NTFS alternate data streams ("file.pdf:hidden") and any colon use
 * beyond the drive/UNC root — a normalized containment check alone would let
 * them through as "inside" paths. */
function hasColonBeyondRoot(candidate: string): boolean {
  if (process.platform !== 'win32') return false
  const root = parse(candidate).root
  return candidate.slice(root.length).includes(':')
}

function lexicalTraversal(candidate: string): boolean {
  return normalize(candidate).split(/[\\/]+/).some(segment => segment === '..')
}

/**
 * The allowed root set, resolved fresh per request from server-owned state:
 * the research state directory plus every registered workflow's run
 * workspace. Roots are resolved through realpath so a symlinked workspace is
 * compared in real-path space and junction escapes fail closed.
 */
function allowedRoots(): string[] {
  const roots = [join(config.appHome, 'research')]
  for (const workflow of listWorkflows()) {
    if (workflow.workspace) roots.push(workflow.workspace)
  }
  const resolved: string[] = []
  for (const root of roots) {
    try {
      resolved.push(realpathSync(root))
    } catch {
      // A root that does not exist (e.g. appHome/research before first use)
      // cannot contain anything servable; skipping keeps the check fail-closed.
    }
  }
  return resolved
}

/**
 * Confine and resolve the requested absolute path. Throws RunFileProxyError:
 * 403 for policy violations (relative path, traversal, stream/colon tricks,
 * symlink escape, non-PDF), 404 when the path does not exist or is not a
 * regular file.
 */
export function confineRunFilePath(requested: string): string {
  const candidate = requested.trim()
  if (!candidate) {
    throw new RunFileProxyError('path is required', 400)
  }
  if (!isAbsolute(candidate)) {
    throw new RunFileProxyError(`path must be absolute, received: ${candidate}`, 403)
  }
  if (lexicalTraversal(candidate)) {
    throw new RunFileProxyError('path escapes the allowed research run roots', 403)
  }
  if (hasColonBeyondRoot(candidate)) {
    throw new RunFileProxyError('path escapes the allowed research run roots', 403)
  }
  const roots = allowedRoots()
  if (!roots.some(root => containsPath(root, candidate))) {
    throw new RunFileProxyError('path escapes the allowed research run roots', 403)
  }

  // realpath resolves symlinks/junctions: a link inside a workspace pointing
  // outside the root set resolves outside and is rejected below.
  let resolved: string
  try {
    resolved = realpathSync(candidate)
  } catch {
    throw new RunFileProxyError(`run file not found: ${candidate}`, 404)
  }
  if (!roots.some(root => containsPath(root, resolved))) {
    throw new RunFileProxyError('path escapes the allowed research run roots', 403)
  }

  let stat
  try {
    stat = statSync(resolved)
  } catch {
    throw new RunFileProxyError(`run file not found: ${candidate}`, 404)
  }
  if (!stat.isFile()) {
    throw new RunFileProxyError(`path is not a regular file: ${candidate}`, 404)
  }
  if (extname(resolved).toLowerCase() !== ALLOWED_EXTENSION) {
    throw new RunFileProxyError(`only ${ALLOWED_EXTENSION} files are served through this endpoint`, 403)
  }
  return resolved
}

type ByteRange = { start: number; end: number }

/**
 * Parse a single-range `Range` header against a known resource size.
 * Returns null when the header is absent, malformed, or multi-range (serve
 * the whole file), and 'unsatisfiable' when the request cannot be met
 * (respond 416). Semantics mirror the library paper streaming endpoint.
 */
function parseRangeHeader(header: string, size: number): ByteRange | null | 'unsatisfiable' {
  const match = /^\s*bytes=(\d*)-(\d*)\s*$/.exec(header)
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    const suffixLength = Number(rawEnd)
    // RFC 7233: a suffix range over a zero-length representation can never
    // be satisfied; without this guard the read stream would open with
    // {start: 0, end: -1} and throw ERR_OUT_OF_RANGE (HTTP 500).
    if (suffixLength === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return null
  return { start, end }
}

/**
 * Open the confined PDF for range streaming. HEAD responses only need the
 * metadata, so `open` may be false to skip the read stream entirely (Koa
 * never consumes a HEAD body; a leaked createReadStream would hold its file
 * descriptor until the next GC pass).
 */
export function openRunFileStream(
  requested: string,
  rangeHeader: string | undefined,
  open = true,
): { filePath: string; size: number; range: ByteRange | null; unsatisfiable: boolean; stream: OpenRunFileStream['stream'] | null; fileName: string } {
  const filePath = confineRunFilePath(requested)
  const size = statSync(filePath).size
  const fileName = basename(filePath)

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, size)
    if (range === 'unsatisfiable') {
      return { filePath, size, range: null, unsatisfiable: true, stream: null, fileName }
    }
    if (range) {
      return {
        filePath,
        size,
        range,
        unsatisfiable: false,
        stream: open
          ? createReadStream(filePath, { start: range.start, end: range.end })
          : null,
        fileName,
      }
    }
  }

  return {
    filePath,
    size,
    range: null,
    unsatisfiable: false,
    stream: open ? createReadStream(filePath) : null,
    fileName,
  }
}
