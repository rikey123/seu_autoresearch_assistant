export interface WorkflowDeterministicNodeRequest {
  workflowId: string
  runId: string
  nodeId: string
  nodeType: string
  title: string
  /** Normalized node data payload (e.g. runtime/code for script nodes). */
  data: Record<string, unknown>
  /** Assembled node input: upstream outputs followed by the current task. */
  input: string
  /** Remaining run-scoped timeout budget in ms; null means no deadline. */
  timeoutMs: number | null
  /** Workspace directory the node executes in; null means inherit. */
  workspace: string | null
  /**
   * Cancellation handle for the owning run: aborted when the run deadline
   * fires or the run is stopped. Optional so existing DI executors stay
   * compatible; executors that receive it must terminate the underlying work
   * (including spawned processes) and settle exactly once.
   */
  signal?: AbortSignal
}

export interface WorkflowDeterministicNodeResult {
  /** Final node output text; structured JSON text when the executor produced JSON. */
  output: string
}

export interface WorkflowRuntimeDependencies {
  isRunCoordinatorAvailable(): boolean
  runAndWait(input: Record<string, unknown>, options: Record<string, unknown>): Promise<any>
  abortSession(sessionId: string, reason: string): Promise<void>
  stopAgentRun(sessionId: string): void
  deletePrimaryAgentSession(sessionId: string, profile: string): Promise<boolean>
  getAvailableModelGroups(profile: string): Promise<any[]>
  /** Executes deterministic (non-agent) workflow nodes; omitted until wired. */
  runDeterministicNode?(request: WorkflowDeterministicNodeRequest): Promise<WorkflowDeterministicNodeResult>
}

let dependencies: WorkflowRuntimeDependencies | null = null

export function configureWorkflowRuntime(next: WorkflowRuntimeDependencies): void {
  dependencies = next
}

function configured(): WorkflowRuntimeDependencies {
  if (!dependencies) throw new Error('Studio workflow runtime has not been configured')
  return dependencies
}

export const isWorkflowRunCoordinatorAvailable = () => configured().isRunCoordinatorAvailable()
export const runWorkflowAndWait = (input: Record<string, unknown>, options: Record<string, unknown>) => (
  configured().runAndWait(input, options)
)
export const abortWorkflowSession = (sessionId: string, reason: string) => (
  configured().abortSession(sessionId, reason)
)
export const stopWorkflowAgentRun = (sessionId: string) => configured().stopAgentRun(sessionId)
export const deleteWorkflowPrimaryAgentSession = (sessionId: string, profile: string) => (
  configured().deletePrimaryAgentSession(sessionId, profile)
)
export const getWorkflowAvailableModelGroups = (profile: string) => (
  configured().getAvailableModelGroups(profile)
)
export const runWorkflowDeterministicNode = (request: WorkflowDeterministicNodeRequest): Promise<WorkflowDeterministicNodeResult> => {
  const executor = configured().runDeterministicNode
  if (!executor) throw new Error('workflow deterministic node executor is not configured')
  return executor(request)
}
