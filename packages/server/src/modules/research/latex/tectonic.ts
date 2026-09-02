// Tectonic engine adapter: binary resolution, subprocess invocation, and
// structured stderr parsing. The compiler is always spawned with an argument
// array and `shell: false` — never a shell command string.
import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { killOwnedProcessTree } from '../../studio/public/process-tree'

export interface TectonicDiagnostic {
  file: string
  line: number | null
  message: string
}

export interface TectonicRunResult {
  exit_code: number | null
  timed_out: boolean
  stdout: string
  stderr: string
}

export type TectonicSpawn = typeof spawn

const DEFAULT_TIMEOUT_MS = 180_000

export function tectonicTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(String(env.HERMES_LATEX_COMPILE_TIMEOUT_MS || ''), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    // Windows X_OK only reports existence quirks for read-only files, which
    // are still launchable; on POSIX a missing exec bit means spawn would fail.
    return process.platform === 'win32' && existsSync(path)
  }
}

function candidatesFor(pathDir: string): string[] {
  if (process.platform === 'win32') {
    // spawn() without a shell cannot launch .bat/.cmd (Node >= 18.20 rejects
    // batch files), so only executable images are viable PATH candidates.
    const pathext = String(process.env.PATHEXT || '.EXE')
      .split(';')
      .map(ext => ext.trim())
      .filter(ext => ext.toLowerCase() === '.exe')
    return [join(pathDir, 'tectonic.exe'), ...pathext.map(ext => join(pathDir, `tectonic${ext.toLowerCase()}`))]
  }
  return [join(pathDir, 'tectonic')]
}

/**
 * Resolve the tectonic binary: TECTONIC_BIN takes precedence, then a PATH
 * scan. Returns null when no usable engine can be located — callers must
 * answer 503 instead of crashing.
 */
export function resolveTectonicBin(
  env: Record<string, string | undefined> = process.env,
): { bin: string; source: 'env' | 'path' } | null {
  const configured = env.TECTONIC_BIN?.trim()
  if (configured) {
    return existsSync(configured) ? { bin: configured, source: 'env' } : null
  }
  const searchPath = env.PATH || env.Path || ''
  for (const dir of searchPath.split(delimiter)) {
    if (!dir.trim()) continue
    for (const candidate of candidatesFor(dir)) {
      if (isExecutableFile(candidate)) return { bin: candidate, source: 'path' }
    }
  }
  return null
}

const TEX_SOURCE_PATTERN = /\.(?:tex|sty|cls|ltx|dtx)$/i
const TEX_FILE_TOKEN_PATTERN = /\((\.?\/[^\s()]+\.tex|[A-Za-z0-9_./\\-]+\.tex)/g

/**
 * Parse tectonic/TeX stderr into structured diagnostics. Understands:
 * - rustc-style summaries:   ./main.tex:12: Undefined control sequence.
 * - rustc-style locations:   --> src/chapter1.tex:12:5   (message from the
 *                             preceding `error:` line)
 * - classic TeX transcripts: `! Undefined control sequence.` followed by
 *                             `l.12 ...`, with the current file tracked
 *                             through TeX's `(./file.tex` paren tokens.
 */
export function parseTectonicErrors(stderr: string, limit = 50): TectonicDiagnostic[] {
  const diagnostics: TectonicDiagnostic[] = []
  const seen = new Set<string>()
  let pendingMessage: string | null = null
  let currentFile = ''

  for (const rawLine of String(stderr || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd()

    for (const match of line.matchAll(TEX_FILE_TOKEN_PATTERN)) {
      currentFile = match[1]
    }

    if (diagnostics.length >= limit) break

    // rustc-style summary lines may carry a severity prefix, e.g.
    // "error: ./main.tex:12: Undefined control sequence." or
    // "warning: bad2.tex:3: ..." — tolerate an optional
    // error/warning/note/help prefix in front of the file:line:message form.
    const fileLineMessage = line.match(/^(?:(?:error|warning|note|help):\s*)?([^:\s][^:]*):(\d+):\s*(.+)$/)
    if (fileLineMessage && TEX_SOURCE_PATTERN.test(fileLineMessage[1].trim())) {
      pushDiagnostic(diagnostics, seen, {
        file: normalizeFilePath(fileLineMessage[1].trim()),
        line: Number.parseInt(fileLineMessage[2], 10),
        message: fileLineMessage[3].trim(),
      })
      pendingMessage = null
      continue
    }

    const arrowLocation = line.match(/^\s*-->\s*([^:\s]+):(\d+):\d+/)
    if (arrowLocation) {
      pushDiagnostic(diagnostics, seen, {
        file: normalizeFilePath(arrowLocation[1]),
        line: Number.parseInt(arrowLocation[2], 10),
        message: pendingMessage || 'compilation error',
      })
      pendingMessage = null
      continue
    }

    const errorMessage = line.match(/^error:\s*(.+)$/i)
    if (errorMessage) {
      pendingMessage = errorMessage[1].trim()
      continue
    }

    const bangMessage = line.match(/^!\s*(.+)$/)
    if (bangMessage) {
      pendingMessage = bangMessage[1].trim()
      continue
    }

    const texLine = line.match(/^l\.(\d+)/)
    if (texLine) {
      const message = pendingMessage
        || (line.slice(texLine[0].length).trim() ? line.slice(texLine[0].length).trim() : 'compilation error')
      pushDiagnostic(diagnostics, seen, {
        file: normalizeFilePath(currentFile),
        line: Number.parseInt(texLine[1], 10),
        message,
      })
      pendingMessage = null
    }
  }

  // `error:` lines without any location still matter (e.g. engine launch
  // failures) — surface them unlocated instead of dropping them.
  if (pendingMessage && diagnostics.length < limit) {
    pushDiagnostic(diagnostics, seen, { file: '', line: null, message: pendingMessage })
  }

  return diagnostics
}

function normalizeFilePath(path: string): string {
  return path.replace(/^\.\[/, '[').replace(/^\.\//, './').replace(/\\/g, '/')
}

function pushDiagnostic(
  diagnostics: TectonicDiagnostic[],
  seen: Set<string>,
  diagnostic: TectonicDiagnostic,
): void {
  const key = `${diagnostic.file}|${diagnostic.line}|${diagnostic.message}`
  if (seen.has(key)) return
  seen.add(key)
  diagnostics.push(diagnostic)
}

/**
 * Run tectonic against a single .tex file. `spawnTectonic` is injectable so
 * tests can simulate process behavior without launching a real engine.
 */
export function runTectonic(options: {
  bin: string
  inputPath: string
  outDir: string
  timeoutMs?: number
  spawnImpl?: TectonicSpawn
}): Promise<TectonicRunResult> {
  const doSpawn = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? tectonicTimeoutMs()
  // Argument array + shell:false — no shell interpolation of file paths.
  const child = doSpawn(options.bin, ['--outdir', options.outDir, options.inputPath], {
    cwd: options.outDir,
    windowsHide: true,
    shell: false,
  })

  return new Promise<TectonicRunResult>((resolve) => {
    // Accumulate raw Buffers and decode once at the end: decoding per chunk
    // would corrupt multi-byte UTF-8 sequences that span a chunk boundary
    // (Chinese comments in LaTeX sources are the common case).
    let stdoutParts: Buffer[] = []
    let stderrParts: Buffer[] = []
    let timedOut = false
    let settled = false

    const appendOutput = (parts: Buffer[], chunk: Buffer): void => {
      parts.push(chunk)
      let total = 0
      for (const part of parts) total += part.length
      if (total > 256_000) {
        // Keep only the newest ~128 KB so a runaway log cannot exhaust memory;
        // copy the tail so it does not retain the whole joined buffer.
        const joined = Buffer.concat(parts)
        parts.length = 0
        parts.push(Buffer.from(joined.subarray(Math.max(0, joined.length - 128_000))))
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      // Same lifecycle rule as the workflow engines: a timed-out compile must
      // take down the whole process tree, not just the direct child.
      killOwnedProcessTree(child.pid, () => child.kill('SIGKILL'))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      appendOutput(stdoutParts, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      appendOutput(stderrParts, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = Buffer.concat(stdoutParts).toString('utf8')
      const stderr = Buffer.concat(stderrParts).toString('utf8')
      resolve({
        exit_code: timedOut ? null : exitCode,
        timed_out: timedOut,
        stdout,
        stderr: timedOut
          ? `${stderr}\nerror: tectonic was terminated after ${timeoutMs}ms\n`.trimStart()
          : stderr,
      })
    }

    child.on('error', (error: Error) => {
      stderrParts.push(Buffer.from(`\nerror: failed to launch tectonic: ${error.message}`))
      finish(null)
    })
    child.on('close', (code: number | null) => finish(code))
  })
}
