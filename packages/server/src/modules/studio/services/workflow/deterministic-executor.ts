import { spawn } from 'node:child_process'
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
}

function runWorkflowScriptProcess(args: {
  code: string
  input: string
  timeoutMs: number | null
  workspace: string | null
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
    const timeoutTimer = args.timeoutMs !== null && args.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, args.timeoutMs)
      : null
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    // A script that exits without draining stdin raises EPIPE on the pipe; the
    // final result is still delivered through the 'close' event.
    child.stdin.on('error', () => {})
    child.on('error', err => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      reject(err)
    })
    child.on('close', exitCode => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      resolve({ exitCode, stdout, stderr, timedOut })
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
  })
  if (result.timedOut) {
    throw new Error(`workflow script node "${request.title}" timed out after ${request.timeoutMs}ms`)
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split(/\r?\n/).slice(-5).join('\n').slice(-2000)
    throw new Error(`workflow script node "${request.title}" failed with exit code ${result.exitCode}: ${detail}`)
  }
  return { output: workflowScriptNodeOutput(result.stdout) }
}
