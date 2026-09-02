// pdf2zh translation queue: persistent jobs, a serial background worker, and
// the exact pdf2zh argv contract used by the paper-translate workflow template
// (structured argv, shell:false, PAPER_TRANSLATE_PDF2ZH_BIN may point at a
// Node wrapper script). Translation is API-first: pdf2zh -s openai drives an
// OpenAI-compatible HTTP endpoint; keys only travel through environment
// variables and nothing ever runs or downloads a local model.
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join } from 'path'
import { killOwnedProcessTree } from '../../studio/public/process-tree'
import {
  closeTranslationQueueDb,
  getTranslationJobRow,
  insertTranslationJob,
  listTranslationJobs,
  nextQueuedTranslationJob,
  updateTranslationJob,
  TRANSLATION_JOB_STATUSES,
  type TranslationJobRecord,
  type TranslationJobStatus,
} from './translation-queue-store'

// The controller reads the raw row for the streaming endpoints; re-exported
// here so controllers only ever depend on the service layer.
export { getTranslationJobRow } from './translation-queue-store'

const DEFAULT_TARGET_LANG = process.env.PAPER_TRANSLATE_TARGET_LANG?.trim() || 'zh'
const DEFAULT_SERVICE = 'openai'
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000
const STDERR_TAIL_BYTES = 8000

export interface TranslationJobFileStat {
  path: string
  exists: boolean
  bytes: number
}

export interface TranslationJobInput {
  pdfPath: string
  targetLang?: string
  service?: string
  outDir?: string
}

export class TranslationJobError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function jobTimeoutMs(): number {
  const raw = Number(process.env.PAPER_TRANSLATE_JOB_TIMEOUT_MS || '')
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JOB_TIMEOUT_MS
}

function tailText(value: string, maxBytes = STDERR_TAIL_BYTES): string {
  const text = value.trim()
  if (!text) return ''
  return text.length > maxBytes ? text.slice(-maxBytes) : text
}

export function statProductFile(filePath: string | null): TranslationJobFileStat | null {
  if (!filePath) return null
  try {
    const stat = statSync(filePath)
    return { path: filePath, exists: stat.isFile(), bytes: stat.isFile() ? stat.size : 0 }
  } catch {
    return { path: filePath, exists: false, bytes: 0 }
  }
}

export function describeTranslationJob(job: TranslationJobRecord): Record<string, unknown> {
  return {
    ...job,
    files: {
      mono: statProductFile(job.mono_path),
      dual: statProductFile(job.dual_path),
    },
  }
}

/** Validate and normalize an enqueue request into a persisted queued job. */
export function enqueueTranslationJob(input: TranslationJobInput): TranslationJobRecord {
  const pdfPath = String(input.pdfPath || '').trim()
  if (!pdfPath) throw new TranslationJobError('pdfPath is required')
  if (!isAbsolute(pdfPath)) {
    throw new TranslationJobError(`pdfPath must be an absolute path, received: ${pdfPath}`)
  }
  try {
    const stat = statSync(pdfPath)
    if (!stat.isFile()) throw new TranslationJobError(`pdfPath is not a regular file: ${pdfPath}`)
  } catch (err) {
    if (err instanceof TranslationJobError) throw err
    throw new TranslationJobError(`PDF file not found: ${pdfPath}`, 404)
  }
  const header = Buffer.alloc(5)
  let handle = -1
  try {
    handle = openSync(pdfPath, 'r')
    readSync(handle, header, 0, 5, 0)
  } finally {
    if (handle >= 0) closeSync(handle)
  }
  if (header.toString('ascii') !== '%PDF-') {
    throw new TranslationJobError(`file is not a PDF (missing %PDF- header): ${pdfPath}`)
  }

  const targetLang = String(input.targetLang || '').trim() || DEFAULT_TARGET_LANG
  const service = String(input.service || '').trim() || DEFAULT_SERVICE
  const outDir = String(input.outDir || '').trim() || join(dirname(pdfPath), 'paper-translate-out')
  const job = insertTranslationJob({
    pdf_path: pdfPath,
    file_name: basename(pdfPath),
    target_lang: targetLang,
    service,
    out_dir: outDir,
  })
  kickWorker()
  return job
}

/** Move a failed job back to the queue; completed/running jobs cannot retry. */
export function retryTranslationJob(id: string): TranslationJobRecord {
  const job = getTranslationJobRow(id)
  if (!job) throw new TranslationJobError('translation job not found', 404)
  if (job.status !== 'failed') {
    throw new TranslationJobError(`only failed jobs can be retried, job ${id} is ${job.status}`)
  }
  const updated = updateTranslationJob(id, {
    status: 'queued',
    error: null,
    mono_path: null,
    dual_path: null,
    started_at: null,
    finished_at: null,
  })
  kickWorker()
  return updated as TranslationJobRecord
}

export function getTranslationJob(id: string): Record<string, unknown> | null {
  const job = getTranslationJobRow(id)
  return job ? describeTranslationJob(job) : null
}

export function listTranslationJobViews(status?: TranslationJobStatus): Array<Record<string, unknown>> {
  const valid = status && (TRANSLATION_JOB_STATUSES as readonly string[]).includes(status)
    ? status
    : undefined
  return listTranslationJobs(valid).map(describeTranslationJob)
}

// ---------------------------------------------------------------------------
// Worker: serial, one running job at a time, spawned pdf2zh subprocess.
// ---------------------------------------------------------------------------

let workerActive = false
let activeChild: ChildProcess | null = null
let workerStopped = false
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  // Best-effort cleanup: never leave a pdf2zh child behind when the server
  // process exits while a job is running.
  process.once('exit', () => {
    try {
      activeChild?.kill('SIGKILL')
    } catch {
      // already gone
    }
  })
}

function kickWorker(): void {
  if (workerActive || workerStopped) return
  workerActive = true
  void drainQueue().finally(() => {
    workerActive = false
  })
}

async function drainQueue(): Promise<void> {
  for (;;) {
    if (workerStopped) return
    const job = nextQueuedTranslationJob()
    if (!job) return
    await runJob(job)
  }
}

interface SpawnOutcome {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function runPdf2zhChild(job: TranslationJobRecord): Promise<SpawnOutcome> {
  const bin = process.env.PAPER_TRANSLATE_PDF2ZH_BIN?.trim() || 'pdf2zh'
  let spawnBin = bin
  let args = ['-i', job.pdf_path, '-o', job.out_dir, '-s', job.service, '-lo', job.target_lang]
  if (/\.(?:js|cjs|mjs)$/i.test(bin)) {
    // Node wrapper script (also the test stub path): execute with the current
    // Node runtime, keeping the exact same structured argv contract.
    spawnBin = process.execPath
    args = [bin, ...args]
  }
  const childEnv: NodeJS.ProcessEnv = { ...process.env }
  const apiKey = process.env.OPENAI_API_KEY || ''
  if (!apiKey && job.service === 'openai') {
    return Promise.resolve({
      code: -1,
      stdout: '',
      stderr: 'OPENAI_API_KEY is not configured in the server environment; '
        + 'set it to an OpenAI-compatible translation endpoint key (API-first only, no local models)',
      timedOut: false,
    })
  }
  childEnv.OPENAI_API_KEY = apiKey
  const timeoutMs = jobTimeoutMs()

  return new Promise<SpawnOutcome>((resolve) => {
    installExitHook()
    const child = spawn(spawnBin, args, {
      cwd: dirname(job.pdf_path),
      shell: false,
      windowsHide: true,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeChild = child
    let stdoutText = ''
    let stderrText = ''
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
      if (activeChild === child) activeChild = null
      resolve({ code, stdout: stdoutText, stderr: stderrText, timedOut })
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutText += chunk
      if (stdoutText.length > 1_000_000) stdoutText = stdoutText.slice(-500_000)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrText += chunk
      if (stderrText.length > 1_000_000) stderrText = stderrText.slice(-500_000)
    })
    child.on('error', (error) => {
      stderrText += `\nfailed to spawn "${bin}": ${error.message}`
      finish(-1)
    })
    child.on('close', (code) => finish(code))
  })
}

async function runJob(job: TranslationJobRecord): Promise<void> {
  const startedAt = Date.now()
  updateTranslationJob(job.id, {
    status: 'running',
    attempts: job.attempts + 1,
    started_at: startedAt,
    finished_at: null,
    error: null,
    mono_path: null,
    dual_path: null,
  })

  const outcome = await runPdf2zhChild(job)
  // The worker was stopped while the child ran (tests, shutdown): leave the
  // persisted row untouched and stop touching the queue database.
  if (workerStopped) return

  if (outcome.timedOut) {
    updateTranslationJob(job.id, {
      status: 'failed',
      error: `pdf2zh timed out after ${jobTimeoutMs()}ms and the process tree was killed`,
      finished_at: Date.now(),
    })
    return
  }
  if (outcome.code !== 0) {
    const detail = tailText(outcome.stderr || outcome.stdout || 'no output')
    updateTranslationJob(job.id, {
      status: 'failed',
      error: `pdf2zh exited with code ${outcome.code}: ${detail}`,
      finished_at: Date.now(),
    })
    return
  }

  const stem = job.file_name.replace(/\.pdf$/i, '')
  const monoPath = join(job.out_dir, `${stem}-mono.pdf`)
  const dualPath = join(job.out_dir, `${stem}-dual.pdf`)
  if (!existsSync(monoPath) || !existsSync(dualPath)) {
    updateTranslationJob(job.id, {
      status: 'failed',
      error: `pdf2zh finished but expected outputs are missing in ${job.out_dir}`
        + ` (looked for ${stem}-mono.pdf and ${stem}-dual.pdf)`,
      finished_at: Date.now(),
    })
    return
  }
  updateTranslationJob(job.id, {
    status: 'completed',
    mono_path: monoPath,
    dual_path: dualPath,
    finished_at: Date.now(),
  })
}

/**
 * Open the dual (or mono) product PDF as a byte range stream.
 * Returns null when the file does not exist; throws a TranslationJobError with
 * a 416 status when the requested range is unsatisfiable.
 */
export function openTranslationProductStream(
  job: TranslationJobRecord,
  kind: 'mono' | 'dual',
  rangeHeader: string | undefined,
): { status: 200 | 206; stream: ReturnType<typeof createReadStream>; start: number; end: number; size: number } | null {
  const filePath = kind === 'dual' ? job.dual_path : job.mono_path
  if (!filePath || !existsSync(filePath)) return null
  const size = statSync(filePath).size
  const unsatisfiable = (range: string): TranslationJobError => {
    const error = new TranslationJobError(`range not satisfiable: ${range}`, 416)
    ;(error as TranslationJobError & { size?: number }).size = size
    return error
  }
  let start = 0
  let end = size - 1
  let partial = false

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (match && (match[1] !== '' || match[2] !== '')) {
      if (match[1] === '') {
        // suffix range: last N bytes
        const suffix = Number(match[2])
        if (suffix <= 0 || size === 0) throw unsatisfiable(rangeHeader)
        start = Math.max(0, size - suffix)
        end = size - 1
      } else {
        start = Number(match[1])
        end = match[2] === '' ? size - 1 : Number(match[2])
      }
      if (size === 0 || start > end || start >= size) {
        throw unsatisfiable(rangeHeader)
      }
      end = Math.min(end, size - 1)
      partial = true
    }
  }

  return {
    status: partial ? 206 : 200,
    stream: createReadStream(filePath, { start, end }),
    start,
    end,
    size,
  }
}

/** Stop the worker and kill an in-flight pdf2zh child (tests and shutdown). */
export function stopTranslationQueueWorker(): void {
  workerStopped = true
  if (activeChild) {
    killOwnedProcessTree(activeChild.pid, () => activeChild?.kill('SIGKILL'))
    activeChild = null
  }
  closeTranslationQueueDb()
}
