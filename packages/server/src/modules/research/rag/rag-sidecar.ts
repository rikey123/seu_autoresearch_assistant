// paper-qa sidecar adapter: resolves the configured sidecar entrypoint and
// speaks the pinned JSON-over-stdio contract. The sidecar receives one JSON
// request object on stdin and must answer with exactly one JSON object on
// stdout (all progress/logging goes to stderr):
//
//   request  { "action": "index", "papers": [{ "id", "title", "path" }] }
//   request  { "action": "ask", "papers": [...], "question": "..." }
//   response { "status": "ok", "action": "index", "chunks": 123, "engine": "..." }
//   response { "status": "ok", "action": "ask", "answer": "...",
//              "citations": [{ "paperId", "page", "snippet }], "engine": "..." }
//   response { "status": "error", "error": "..." }
//
// RAG_SIDECAR_BIN may point at a Node wrapper script (.js/.cjs/.mjs — executed
// with the current Node runtime, the same test-stub path as the pdf2zh
// sidecar), a Python adapter script (.py/.pyw — executed with
// RAG_SIDECAR_PYTHON or `python`), or a directly executable image. The child
// is always spawned from a structured argv with shell:false.
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { killOwnedProcessTree } from '../../studio/public/process-tree'

export type RagSidecarAction = 'index' | 'ask'

export interface RagSidecarPaper {
  id: string
  title: string
  path: string
}

export interface RagSidecarRequest {
  action: RagSidecarAction
  papers: RagSidecarPaper[]
  question?: string
}

export interface RagSidecarCitation {
  paperId: string
  page: number | null
  snippet: string
}

export interface RagSidecarResponse {
  status: 'ok' | 'error'
  action?: RagSidecarAction
  engine?: string
  chunks?: number
  answer?: string
  citations?: RagSidecarCitation[]
  error?: string
}

export interface RagSidecarRunOutcome {
  code: number | null
  response: RagSidecarResponse | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type RagSidecarSpawn = typeof spawn

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_STREAM_BYTES = 2_000_000

export function ragSidecarTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(String(env.RAG_SIDECAR_TIMEOUT_MS || ''), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

/**
 * Resolve the sidecar entrypoint. Returns null when RAG_SIDECAR_BIN is unset
 * or the configured file does not exist — callers must fail the task with a
 * clear operator-facing error instead of guessing.
 */
export function resolveSidecarLaunch(
  env: Record<string, string | undefined> = process.env,
): { bin: string; args: string[] } | null {
  const configured = env.RAG_SIDECAR_BIN?.trim()
  if (!configured) return null
  if (/\.(?:js|cjs|mjs)$/i.test(configured)) {
    return { bin: process.execPath, args: [configured] }
  }
  if (/\.(?:py|pyw)$/i.test(configured)) {
    const python = env.RAG_SIDECAR_PYTHON?.trim() || 'python'
    return { bin: python, args: [configured] }
  }
  return { bin: configured, args: [] }
}

/**
 * Environment handed to the sidecar. API-first: the LLM/embedding endpoint is
 * an OpenAI-compatible HTTP API configured purely through environment
 * variables; keys never touch disk and no local model is ever launched.
 */
export function sidecarEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  const passthrough = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'RAG_EMBEDDING_MODEL',
    'RAG_EMBEDDING_BASE_URL',
  ]
  for (const key of passthrough) {
    const value = base[key]
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

export function parseSidecarStdout(stdout: string): RagSidecarResponse | null {
  const text = stdout.trim()
  if (!text) return null
  // Third-party sidecars can print progress banners before the answer object
  // (litellm does this on provider fallbacks), so the contract is: the last
  // JSON object on stdout is the response. Scan for the final balanced {...}
  // that parses and carries a status field.
  for (let start = text.lastIndexOf('{'); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    const candidate = text.slice(start).trim()
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const record = parsed as Record<string, unknown>
      if (typeof record.status !== 'string') continue
      const status = record.status === 'ok' ? 'ok' : 'error'
      const action = record.action === 'index' || record.action === 'ask' ? record.action : undefined
      return {
        status,
        action,
        engine: typeof record.engine === 'string' ? record.engine : undefined,
        chunks: typeof record.chunks === 'number' && Number.isSafeInteger(record.chunks) ? record.chunks : undefined,
        answer: typeof record.answer === 'string' ? record.answer : undefined,
        citations: parseCitations(record.citations),
        error: typeof record.error === 'string' ? record.error : undefined,
      }
    } catch {
      // keep scanning backwards for an earlier JSON object start
    }
  }
  return null
}

function parseCitations(value: unknown): RagSidecarCitation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const citations: RagSidecarCitation[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const paperId = typeof record.paperId === 'string' ? record.paperId : ''
    if (!paperId) continue
    citations.push({
      paperId,
      page: typeof record.page === 'number' && Number.isSafeInteger(record.page) ? record.page : null,
      snippet: typeof record.snippet === 'string' ? record.snippet : '',
    })
  }
  return citations
}

/**
 * Run one sidecar request to completion. The promise always settles exactly
 * once; a timed-out child's whole process tree is killed through the Studio
 * process-tree facade (the latex/BC-5 lifecycle standard).
 */
export function runSidecar(options: {
  request: RagSidecarRequest
  bin: string
  args: string[]
  timeoutMs?: number
  spawnImpl?: RagSidecarSpawn
  onSpawn?: (child: ChildProcess) => void
}): Promise<RagSidecarRunOutcome> {
  const doSpawn = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? ragSidecarTimeoutMs()
  const child = doSpawn(options.bin, options.args, {
    shell: false,
    windowsHide: true,
    env: sidecarEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcess
  options.onSpawn?.(child)

  return new Promise<RagSidecarRunOutcome>((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      killOwnedProcessTree(child.pid, () => child.kill('SIGKILL'))
    }, timeoutMs)

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code,
        response: timedOut ? null : parseSidecarStdout(stdout),
        stdout,
        stderr,
        timedOut,
      })
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_STREAM_BYTES) stdout = stdout.slice(-MAX_STREAM_BYTES / 2)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > MAX_STREAM_BYTES) stderr = stderr.slice(-MAX_STREAM_BYTES / 2)
    })

    child.on('error', (error: Error) => {
      stderr += `\nfailed to spawn the RAG sidecar "${options.bin}": ${error.message}`
      finish(-1)
    })

    // The child owns stdin: write the single JSON request and close our end so
    // the sidecar sees EOF after the request object.
    child.stdin?.on('error', () => {
      // A sidecar that exits before reading stdin raises EPIPE here; the
      // close handler still settles the outcome.
    })
    child.stdin?.end(`${JSON.stringify(options.request)}\n`)

    child.on('close', (code: number | null) => finish(code))
  })
}
