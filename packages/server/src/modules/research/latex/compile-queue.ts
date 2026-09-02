// Serial in-process compile queue. Each queued compilation runs tectonic one
// at a time so a burst of compile requests cannot saturate the host, and the
// resulting PDF is registered into the shared artifact registry.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerArtifact } from '../artifacts/artifact-service'
import { latexBuildsDir, getCompilation, getDocument, updateCompilation } from './latex-store'
import { parseTectonicErrors, resolveTectonicBin, runTectonic } from './tectonic'

const LOG_TAIL_LIMIT = 20_000
const INPUT_FILE_NAME = 'document.tex'
const OUTPUT_FILE_NAME = 'document.pdf'

const pendingIds: string[] = []
let draining = false

export function compilationInputPath(compilationId: string): string {
  return join(compilationBuildDir(compilationId), INPUT_FILE_NAME)
}

export function compilationPdfPath(compilationId: string): string {
  return join(compilationBuildDir(compilationId), OUTPUT_FILE_NAME)
}

export function compilationBuildDir(compilationId: string): string {
  return join(latexBuildsDir(), compilationId)
}

export function enqueueCompilation(compilationId: string): void {
  pendingIds.push(compilationId)
  void drain()
}

export function queueDepth(): number {
  return pendingIds.length
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (pendingIds.length > 0) {
      const id = pendingIds.shift()
      if (id === undefined) continue
      try {
        await runCompilation(id)
      } catch (error) {
        // A queue entry must never take the whole worker down.
        markFailed(id, [{ file: '', line: null, message: `compiler crashed: ${(error as Error).message}` }])
      }
    }
  } finally {
    draining = false
  }
}

function markFailed(compilationId: string, errors: Array<{ file: string; line: number | null; message: string }>): void {
  updateCompilation(compilationId, {
    status: 'failed',
    errors,
    finished_at: Date.now(),
  })
}

function tailLog(value: string): string {
  return value.length > LOG_TAIL_LIMIT ? value.slice(-LOG_TAIL_LIMIT) : value
}

export async function runCompilation(compilationId: string): Promise<void> {
  const record = getCompilation(compilationId)
  if (!record || record.status !== 'queued') return
  const doc = getDocument(record.document_id)
  if (!doc) {
    markFailed(compilationId, [{ file: '', line: null, message: 'document no longer exists' }])
    return
  }

  const resolved = resolveTectonicBin()
  if (!resolved) {
    markFailed(compilationId, [{
      file: '',
      line: null,
      message: 'tectonic compiler is not configured; set TECTONIC_BIN or install tectonic in PATH',
    }])
    return
  }

  const buildDir = compilationBuildDir(compilationId)
  mkdirSync(buildDir, { recursive: true })
  const inputPath = compilationInputPath(compilationId)
  writeFileSync(inputPath, doc.source, 'utf8')

  updateCompilation(compilationId, { status: 'running', started_at: Date.now() })
  const result = await runTectonic({ bin: resolved.bin, inputPath, outDir: buildDir })
  const log = tailLog(`${result.stdout}\n${result.stderr}`.trim())
  const pdfPath = compilationPdfPath(compilationId)
  const producedPdf = !result.timed_out && result.exit_code === 0 && existsSync(pdfPath)

  if (producedPdf) {
    let artifactId: string | null = null
    try {
      const artifact = registerArtifact({
        type: 'pdf',
        title: `${doc.title} (compiled PDF)`,
        project_id: doc.project_id,
        preview: {
          documentId: doc.id,
          compilationId,
          byteSize: statSync(pdfPath).size,
        },
      })
      artifactId = artifact.id
    } catch {
      // Registry registration is best-effort; the compile itself succeeded
      // and the PDF stays servable through the latex module.
    }
    updateCompilation(compilationId, {
      status: 'completed',
      exit_code: 0,
      artifact_id: artifactId,
      log,
      finished_at: Date.now(),
    })
    return
  }

  const errors = parseTectonicErrors(result.stderr)
  if (errors.length === 0) {
    errors.push({
      file: '',
      line: null,
      message: result.timed_out
        ? 'compilation timed out'
        : result.exit_code === 0
          ? 'tectonic reported success but produced no PDF output'
          : `compilation failed with exit code ${result.exit_code}`,
    })
  }
  updateCompilation(compilationId, {
    status: 'failed',
    exit_code: result.exit_code,
    errors,
    log,
    finished_at: Date.now(),
  })
}
