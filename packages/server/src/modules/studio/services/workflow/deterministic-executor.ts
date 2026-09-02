import { spawn } from 'node:child_process'
import { killOwnedProcessTree } from '../../infrastructure/process-tree'
import type {
  WorkflowDeterministicNodeRequest,
  WorkflowDeterministicNodeResult,
} from '../../public/workflow-runtime'

/**
 * Central registry for deterministic (non-agent) workflow node types. Every
 * supported type must appear exactly once here; schedulers only branch on
 * "agent vs deterministic" and delegate the rest to this module.
 */
export const DETERMINISTIC_WORKFLOW_NODE_TYPES = ['script', 'validate', 'render'] as const

export type WorkflowDeterministicNodeType = (typeof DETERMINISTIC_WORKFLOW_NODE_TYPES)[number]

export function isDeterministicWorkflowNodeType(type: string): type is WorkflowDeterministicNodeType {
  return (DETERMINISTIC_WORKFLOW_NODE_TYPES as readonly string[]).includes(type)
}

/** Per-stream stdout/stderr budget; crossing it terminates the process tree. */
export const WORKFLOW_SCRIPT_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024
/** Trailing diagnostic buffer retained once a stream crosses the limit. */
export const WORKFLOW_SCRIPT_OUTPUT_TAIL_BYTES = 64 * 1024

type WorkflowDeterministicNodeExecutor = (
  request: WorkflowDeterministicNodeRequest,
) => Promise<WorkflowDeterministicNodeResult>

/**
 * `null` marks a registered type whose engine contract already exists but
 * whose executor is not implemented yet; execution fails loudly instead of
 * silently succeeding.
 */
const executors: Record<WorkflowDeterministicNodeType, WorkflowDeterministicNodeExecutor | null> = {
  script: executeScriptWorkflowNode,
  validate: null,
  render: null,
}

export function isWorkflowDeterministicNodeExecutorConfigured(type: WorkflowDeterministicNodeType): boolean {
  return executors[type] !== null
}

export async function executeWorkflowDeterministicNode(
  request: WorkflowDeterministicNodeRequest,
): Promise<WorkflowDeterministicNodeResult> {
  if (!isDeterministicWorkflowNodeType(request.nodeType)) {
    throw new Error(`workflow node ${request.nodeId} has no registered deterministic executor for node type: ${request.nodeType}`)
  }
  const executor = executors[request.nodeType]
  if (!executor) {
    throw new Error(`workflow node ${request.nodeId} uses deterministic node type "${request.nodeType}" whose executor is not configured yet`)
  }
  return executor(request)
}

interface WorkflowScriptProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Stream that crossed the output limit, when the process was terminated for it. */
  outputLimitStream: 'stdout' | 'stderr' | null
  /** Set when the request's cancellation signal fired before a normal close. */
  aborted: boolean
}

/** Keep only a trailing buffer for oversized streams (UTF-8 safe, best effort). */
function retainedTail(value: string): string {
  const maxChars = Math.floor(WORKFLOW_SCRIPT_OUTPUT_TAIL_BYTES / 4)
  let tail = value.length > maxChars ? value.slice(-maxChars) : value
  while (Buffer.byteLength(tail) > WORKFLOW_SCRIPT_OUTPUT_TAIL_BYTES && tail.length > 0) {
    tail = tail.slice(Math.ceil(tail.length / 2))
  }
  return tail
}

function runWorkflowScriptProcess(args: {
  code: string
  input: string
  timeoutMs: number | null
  workspace: string | null
  signal?: AbortSignal
}): Promise<WorkflowScriptProcessResult> {
  return new Promise((resolve, reject) => {
    // Structured argv only — never build a shell command string from node data.
    const child = spawn(process.execPath, ['-e', args.code], {
      cwd: args.workspace || undefined,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let settled = false
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let outputLimitStream: 'stdout' | 'stderr' | null = null
    let aborted = false
    const killTree = () => killOwnedProcessTree(child.pid, () => child.kill('SIGKILL'))
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    let onAbort: () => void = () => {}
    // Exactly one settlement: abort, output limit, timeout, spawn error, and
    // close all funnel through here; later events are ignored.
    const settle = (error: Error | null, result?: WorkflowScriptProcessResult) => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      args.signal?.removeEventListener('abort', onAbort)
      if (error || !result) reject(error || new Error('workflow script process settled without a result'))
      else resolve(result)
    }
    onAbort = () => {
      if (settled) return
      aborted = true
      killTree()
      settle(null, {
        exitCode: null,
        stdout: retainedTail(stdout),
        stderr: retainedTail(stderr),
        timedOut: false,
        outputLimitStream: null,
        aborted: true,
      })
    }
    const exceedOutputLimit = (stream: 'stdout' | 'stderr') => {
      if (settled || outputLimitStream) return
      outputLimitStream = stream
      killTree()
      settle(null, {
        exitCode: null,
        stdout: retainedTail(stdout),
        stderr: retainedTail(stderr),
        timedOut: false,
        outputLimitStream: stream,
        aborted: false,
      })
    }
    timeoutTimer = args.timeoutMs !== null && args.timeoutMs > 0
      ? setTimeout(() => {
          // A timed-out script must take down the whole tree, not just the
          // direct child — spawned workers otherwise survive the kill.
          timedOut = true
          killTree()
        }, args.timeoutMs)
      : null
    if (args.signal?.aborted) onAbort()
    else args.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (settled || outputLimitStream) return
      stdout += chunk
      if (Buffer.byteLength(stdout) > WORKFLOW_SCRIPT_OUTPUT_LIMIT_BYTES) exceedOutputLimit('stdout')
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      if (settled || outputLimitStream) return
      stderr += chunk
      if (Buffer.byteLength(stderr) > WORKFLOW_SCRIPT_OUTPUT_LIMIT_BYTES) exceedOutputLimit('stderr')
    })
    // A script that exits without draining stdin raises EPIPE on the pipe; the
    // final result is still delivered through the 'close' event.
    child.stdin.on('error', () => {})
    child.on('error', err => {
      settle(err)
    })
    child.on('close', exitCode => {
      settle(null, {
        exitCode,
        stdout: outputLimitStream ? retainedTail(stdout) : stdout,
        stderr: outputLimitStream ? retainedTail(stderr) : stderr,
        timedOut,
        outputLimitStream,
        aborted,
      })
    })
    child.stdin.end(args.input)
  })
}

/** Prefer the last stdout line as structured JSON; fall back to the full text. */
function workflowScriptNodeOutput(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ''
  const lastLine = trimmed.split(/\r?\n/).pop()!.trim()
  if (lastLine) {
    try {
      return JSON.stringify(JSON.parse(lastLine))
    } catch {
      // Last line is not JSON — keep the plain stdout text.
    }
  }
  return trimmed
}

async function executeScriptWorkflowNode(request: WorkflowDeterministicNodeRequest): Promise<WorkflowDeterministicNodeResult> {
  const runtime = typeof request.data.runtime === 'string' && request.data.runtime.trim()
    ? request.data.runtime.trim()
    : 'node'
  if (runtime !== 'node') {
    throw new Error(`workflow script node "${request.title}" has unsupported script runtime: ${runtime}`)
  }
  const code = typeof request.data.code === 'string' ? request.data.code : ''
  if (!code.trim()) {
    throw new Error(`workflow script node "${request.title}" has no script code to execute`)
  }
  const result = await runWorkflowScriptProcess({
    code,
    input: request.input,
    timeoutMs: request.timeoutMs,
    workspace: request.workspace,
    signal: request.signal,
  })
  if (result.outputLimitStream) {
    throw new Error(
      `workflow script node "${request.title}" output limit exceeded on ${result.outputLimitStream}`
      + ` (limit ${WORKFLOW_SCRIPT_OUTPUT_LIMIT_BYTES} bytes per stream);`
      + ` only the trailing ${WORKFLOW_SCRIPT_OUTPUT_TAIL_BYTES} bytes were retained`,
    )
  }
  if (result.aborted) {
    throw new Error(`workflow script node "${request.title}" aborted before completion`)
  }
  if (result.timedOut) {
    throw new Error(`workflow script node "${request.title}" timed out after ${request.timeoutMs}ms`)
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split(/\r?\n/).slice(-5).join('\n').slice(-2000)
    throw new Error(`workflow script node "${request.title}" failed with exit code ${result.exitCode}: ${detail}`)
  }
  return { output: workflowScriptNodeOutput(result.stdout) }
}
