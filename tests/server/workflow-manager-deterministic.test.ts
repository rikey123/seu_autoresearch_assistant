import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const originalDeterministicTestDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalDeterministicTestWebUiHome = process.env.HERMES_WEB_UI_HOME
const originalDeterministicTestStateDir = process.env.HERMES_WEBUI_STATE_DIR
const deterministicTestRoot = mkdtempSync(join(tmpdir(), 'hermes-workflow-deterministic-'))
const deterministicTestDbDir = join(deterministicTestRoot, 'db')
const deterministicTestHome = join(deterministicTestRoot, 'home')
process.env.HERMES_WEB_UI_TEST_DB_DIR = deterministicTestDbDir
process.env.HERMES_WEB_UI_HOME = deterministicTestHome
process.env.HERMES_WEBUI_STATE_DIR = deterministicTestHome

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const chatRunMock = vi.hoisted(() => ({
  runAndWait: vi.fn(),
  abortSession: vi.fn(),
  sessionOutputs: new Map<string, string>(),
}))

const deterministicExecutorMock = vi.hoisted(() => ({
  run: vi.fn(),
}))

const sessionStoreMock = vi.hoisted(() => ({
  createSession: vi.fn((data: { id: string }) => ({ id: data.id })),
}))

vi.mock('../../packages/server/src/modules/studio/services/workflow/skill-resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/server/src/modules/studio/services/workflow/skill-resolver')>()
  return {
    ...actual,
    resolveWorkflowSkillContent: () => Promise.resolve(null),
  }
})

vi.mock('../../packages/server/src/modules/studio/public/workflow-runtime', () => ({
  isWorkflowRunCoordinatorAvailable: () => true,
  runWorkflowAndWait: (input: Record<string, unknown>, options: Record<string, unknown>) => chatRunMock.runAndWait(input, options),
  abortWorkflowSession: (sessionId: string, reason: string) => chatRunMock.abortSession(sessionId, reason),
  stopWorkflowAgentRun: vi.fn(),
  deleteWorkflowPrimaryAgentSession: vi.fn(async () => true),
  getWorkflowAvailableModelGroups: vi.fn(async () => []),
  runWorkflowDeterministicNode: (request: Record<string, unknown>) => deterministicExecutorMock.run(request),
}))

vi.mock('../../packages/server/src/modules/studio/services/agent-availability', () => ({
  assertAgentAvailable: vi.fn(),
}))

vi.mock('../../packages/server/src/modules/studio/repositories/session-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/server/src/modules/studio/repositories/session-store')>()
  return {
    ...actual,
    createSession: sessionStoreMock.createSession,
    getSession: vi.fn(() => null),
    getSessionDetail: vi.fn((sessionId: string) => ({
      messages: [{ role: 'assistant', content: chatRunMock.sessionOutputs.get(sessionId) || `output:${sessionId}` }],
    })),
    deleteSession: vi.fn(),
  }
})

afterAll(async () => {
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
  closeDb()
  restoreEnvironmentVariable('HERMES_WEB_UI_TEST_DB_DIR', originalDeterministicTestDbDir)
  restoreEnvironmentVariable('HERMES_WEB_UI_HOME', originalDeterministicTestWebUiHome)
  restoreEnvironmentVariable('HERMES_WEBUI_STATE_DIR', originalDeterministicTestStateDir)
  rmSync(deterministicTestRoot, { recursive: true, force: true })
})

beforeAll(async () => {
  const { initAllStores } = await import('../../packages/server/src/modules/studio/infrastructure/database/init')
  initAllStores()
})

beforeEach(() => {
  chatRunMock.runAndWait.mockReset()
  chatRunMock.abortSession.mockReset()
  chatRunMock.sessionOutputs.clear()
  deterministicExecutorMock.run.mockReset()
  sessionStoreMock.createSession.mockClear()
})

async function importManagerUnderTest() {
  return {
    manager: await import('../../packages/server/src/modules/studio/services/workflow/manager'),
    workflowStore: await import('../../packages/server/src/modules/studio/repositories/workflow-store'),
    executor: await import('../../packages/server/src/modules/studio/services/workflow/deterministic-executor'),
  }
}

describe('deterministic workflow node normalization', () => {
  it('accepts script/validate/render and strips unknown data fields', async () => {
    const { manager } = await importManagerUnderTest()

    expect(manager.normalizeWorkflowNode({
      id: 's1', type: 'script', position: { x: 10, y: 20 },
      data: { title: 'Prep', runtime: 'node', code: 'console.log(1)', input: 'go', agent: 'hermes', skills: ['x'], junk: 'drop-me' },
    })).toEqual({
      id: 's1', type: 'script', position: { x: 10, y: 20 },
      data: { title: 'Prep', input: 'go', orchestration: { join: 'all' }, runtime: 'node', code: 'console.log(1)' },
    })

    expect(manager.normalizeWorkflowNode({ id: 'v1', type: 'validate', data: {} })).toEqual({
      id: 'v1', type: 'validate',
      data: { title: 'v1', input: '', orchestration: { join: 'all' } },
    })

    expect(manager.normalizeWorkflowNode({ id: 'r1', type: 'render', data: { orchestration: { join: 'any' } } })).toEqual({
      id: 'r1', type: 'render',
      data: { title: 'r1', input: '', orchestration: { join: 'any' } },
    })
  })

  it('keeps agent nodes unchanged and explicitly rejects unknown types and bad payloads', async () => {
    const { manager } = await importManagerUnderTest()

    expect(manager.normalizeWorkflowNode({ id: 'a1', type: 'agent', data: { agent: 'codex', input: 'task', orchestration: { join: 'any' } } })).toMatchObject({
      id: 'a1', type: 'agent',
      data: { agent: 'codex', input: 'task', agentMode: 'scoped', orchestration: { join: 'any' }, approvalRequired: false },
    })

    expect(() => manager.normalizeWorkflowNode({ id: 'shell', type: 'shell', data: { agent: 'hermes' } }))
      .toThrow('workflow node shell must be an Agent node')
    expect(() => manager.normalizeWorkflowNode({ id: 's2', type: 'script', data: { runtime: 'python' } }))
      .toThrow('workflow node s2 has unsupported script runtime: python')
    expect(() => manager.normalizeWorkflowNode({ id: 's3', type: 'script', data: { orchestration: { join: 'some' } } }))
      .toThrow('workflow node s3 has invalid orchestration join')
  })
})

describe('deterministic script executor', () => {
  const baseRequest = {
    workflowId: 'wf-1',
    runId: 'run-1',
    nodeId: 's1',
    nodeType: 'script',
    title: 'echo',
    data: {},
    input: '',
    timeoutMs: 15000,
    workspace: null,
  }

  it('executes script nodes in a real node subprocess with stdin input and structured output', async () => {
    const { executor } = await importManagerUnderTest()

    const jsonResult = await executor.executeWorkflowDeterministicNode({
      ...baseRequest,
      data: {
        runtime: 'node',
        code: 'let raw="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{raw+=chunk});process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({echo:raw.trim()}))})',
      },
      input: 'hello workflow',
    })
    expect(jsonResult.output).toBe(JSON.stringify({ echo: 'hello workflow' }))

    const textResult = await executor.executeWorkflowDeterministicNode({
      ...baseRequest,
      nodeId: 's2',
      data: { code: 'process.stdout.write("line one\\n");console.log("plain output")' },
    })
    expect(textResult.output).toBe('line one\nplain output')
  })

  it('fails script nodes on non-zero exit with stderr detail', async () => {
    const { executor } = await importManagerUnderTest()

    await expect(executor.executeWorkflowDeterministicNode({
      ...baseRequest,
      data: { code: 'console.error("kaputt");process.exit(3)' },
    })).rejects.toThrow(/exit code 3[\s\S]*kaputt/)
  })

  it('rejects validate and render execution until their executors are configured', async () => {
    const { executor } = await importManagerUnderTest()

    await expect(executor.executeWorkflowDeterministicNode({ ...baseRequest, nodeId: 'v1', nodeType: 'validate', title: 'v' }))
      .rejects.toThrow('executor is not configured yet')
    await expect(executor.executeWorkflowDeterministicNode({ ...baseRequest, nodeId: 'r1', nodeType: 'render', title: 'r' }))
      .rejects.toThrow('executor is not configured yet')
  })
})

describe('deterministic workflow dispatch', () => {
  it('runs a mixed agent+script workflow end to end without creating chat sessions for script nodes', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
    deterministicExecutorMock.run.mockResolvedValue({ output: 'SCRIPT-OUTPUT-1' })

    const workflow = workflowStore.createWorkflow({
      name: 'mixed run',
      profile: 'default',
      nodes: [
        { id: 'agent-1', type: 'agent', data: { title: 'Agent', agent: 'hermes', input: 'draft' } },
        { id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } },
      ],
      edges: [{ id: 'e1', source: 'agent-1', target: 'script-1' }],
    })
    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)

    expect(result.run.status).toBe('completed')
    expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(1)
    expect(sessionStoreMock.createSession).toHaveBeenCalledTimes(1)
    expect(deterministicExecutorMock.run).toHaveBeenCalledTimes(1)

    const agentRows = result.nodeSessions.filter(session => session.node_id === 'agent-1')
    expect(agentRows).toHaveLength(1)
    expect(agentRows[0].session_id).not.toBe('')
    expect(agentRows[0].status).toBe('completed')

    const scriptRows = result.nodeSessions.filter(session => session.node_id === 'script-1')
    expect(scriptRows).toHaveLength(1)
    expect(scriptRows[0].session_id).toBe('')
    expect(scriptRows[0].agent).toBe('')
    expect(scriptRows[0].status).toBe('completed')
    expect(scriptRows[0].output_json).toBe('SCRIPT-OUTPUT-1')

    const executorRequest = deterministicExecutorMock.run.mock.calls[0][0]
    expect(executorRequest.nodeType).toBe('script')
    expect(executorRequest.title).toBe('Script')
    expect(executorRequest.input).toContain('[Upstream: Agent]')
  })

  it('marks script nodes failed with the executor error instead of aborting silently', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    deterministicExecutorMock.run.mockRejectedValue(new Error('boom in script'))

    const workflow = workflowStore.createWorkflow({
      name: 'failing script',
      profile: 'default',
      nodes: [{ id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } }],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)

    expect(result.run.status).toBe('failed')
    expect(String(result.run.error)).toContain('boom in script')
    const scriptRow = result.nodeSessions.find(session => session.node_id === 'script-1')!
    expect(scriptRow.session_id).toBe('')
    expect(scriptRow.status).toBe('failed')
    expect(scriptRow.error).toContain('boom in script')
    expect(chatRunMock.runAndWait).not.toHaveBeenCalled()
    expect(sessionStoreMock.createSession).not.toHaveBeenCalled()
  })

  it('reruns a completed script node through preflight and stores the fresh output', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
    deterministicExecutorMock.run.mockResolvedValueOnce({ output: 'SCRIPT-OUTPUT-1' })

    const workflow = workflowStore.createWorkflow({
      name: 'script rerun',
      profile: 'default',
      nodes: [
        { id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } },
        { id: 'agent-1', type: 'agent', data: { title: 'Agent', agent: 'hermes', input: 'polish' } },
      ],
      edges: [{ id: 'e1', source: 'script-1', target: 'agent-1' }],
    })
    const instance = new manager.WorkflowManager()
    const first = await instance.runNow(workflow.id)
    expect(first.run.status).toBe('completed')

    deterministicExecutorMock.run.mockResolvedValueOnce({ output: 'RERUN-SCRIPT-9' })
    const rerun = await instance.rerunFromNode(workflow.id, first.run.id, 'script-1')
    expect(rerun.run.status).toBe('completed')

    const scriptRows = rerun.nodeSessions.filter(session => session.node_id === 'script-1')
    expect(scriptRows).toHaveLength(2)
    expect(scriptRows.at(-1)!.session_id).toBe('')
    expect(scriptRows.at(-1)!.status).toBe('completed')
    expect(scriptRows.at(-1)!.output_json).toBe('RERUN-SCRIPT-9')
    // Agent sessions: one for the initial run + one for the rerun (rerun re-executes
    // the target's downstream agent too); script nodes never create one.
    expect(sessionStoreMock.createSession).toHaveBeenCalledTimes(2)
    expect(deterministicExecutorMock.run).toHaveBeenCalledTimes(2)
  })

  it('restores script node output from the run-store column when rerunning a downstream agent node', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
    deterministicExecutorMock.run.mockResolvedValueOnce({ output: 'SCRIPT-DATA-42' })

    const workflow = workflowStore.createWorkflow({
      name: 'script restore',
      profile: 'default',
      nodes: [
        { id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } },
        { id: 'agent-1', type: 'agent', data: { title: 'Agent', agent: 'hermes', input: 'polish' } },
      ],
      edges: [{ id: 'e1', source: 'script-1', target: 'agent-1' }],
    })
    const instance = new manager.WorkflowManager()
    const first = await instance.runNow(workflow.id)
    expect(first.run.status).toBe('completed')

    const rerun = await instance.rerunFromNode(workflow.id, first.run.id, 'agent-1')
    expect(rerun.run.status).toBe('completed')

    expect(deterministicExecutorMock.run).toHaveBeenCalledTimes(1)
    const agentCall = chatRunMock.runAndWait.mock.calls.at(-1)!
    expect(String(agentCall[0].input)).toContain('SCRIPT-DATA-42')
    const scriptRows = rerun.nodeSessions.filter(session => session.node_id === 'script-1')
    expect(scriptRows).toHaveLength(1)
  })
})

describe('deterministic engine lifecycle', () => {
  async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`timed out waiting for ${label}`)
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  function killPidSafe(pidPath: string): void {
    try {
      if (existsSync(pidPath)) process.kill(Number(readFileSync(pidPath, 'utf8')), 'SIGKILL')
    } catch {
      // Best-effort cleanup between assertions only.
    }
  }

  /** Route the mocked runtime dependency through the real executor. */
  function useRealExecutor(executor: Awaited<ReturnType<typeof importManagerUnderTest>>['executor']): void {
    deterministicExecutorMock.run.mockImplementation(
      request => executor.executeWorkflowDeterministicNode(request as Parameters<typeof executor.executeWorkflowDeterministicNode>[0]),
    )
  }

  it('stopRun without a deadline kills a long-running script process and lands its node row canceled', async () => {
    const { manager, workflowStore, executor } = await importManagerUnderTest()
    const runStore = await import('../../packages/server/src/modules/studio/repositories/workflow-run-store')
    const pidPath = join(deterministicTestRoot, `stop-pid-${randomUUID()}.txt`)
    useRealExecutor(executor)

    const workflow = workflowStore.createWorkflow({
      name: 'stoppable long script', profile: 'default',
      nodes: [{
        id: 'long-1', type: 'script', data: {
          title: 'Long', runtime: 'node',
          code: `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));setInterval(() => {}, 250);`,
        },
      }],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    const runPromise = instance.runNow(workflow.id)
    try {
      await waitFor(() => existsSync(pidPath), 15000, 'script process to report its pid')
      const pid = Number(readFileSync(pidPath, 'utf8'))
      expect(pid).toBeGreaterThan(0)
      expect(isProcessAlive(pid)).toBe(true)

      await waitFor(() => Boolean(runStore.listWorkflowRuns(workflow.id)[0]), 5000, 'the run row to be persisted')
      const runId = runStore.listWorkflowRuns(workflow.id)[0]!.id
      await instance.stopRun(workflow.id, runId, 'operator stopped long script')

      const result = await runPromise
      expect(result.run.status).toBe('canceled')
      expect(result.run.error).toBe('operator stopped long script')
      expect(chatRunMock.runAndWait).not.toHaveBeenCalled()
      expect(chatRunMock.abortSession).not.toHaveBeenCalled()
      const rows = result.nodeSessions.filter(session => session.node_id === 'long-1')
      expect(rows).toHaveLength(1)
      expect(rows[0].session_id).toBe('')
      expect(rows[0].status).toBe('canceled')
      expect(rows[0].error).toBe('operator stopped long script')

      await waitFor(() => !isProcessAlive(pid), 10000, 'the script process to exit after stopRun')
      expect(isProcessAlive(pid)).toBe(false)
    } finally {
      killPidSafe(pidPath)
    }
  })

  it.runIf(process.platform === 'win32')('run deadline after a script spawned a grandchild tears down the whole process tree', async () => {
    const { manager, workflowStore, executor } = await importManagerUnderTest()
    const childPidPath = join(deterministicTestRoot, `tree-child-${randomUUID()}.txt`)
    const grandchildPidPath = join(deterministicTestRoot, `tree-grandchild-${randomUUID()}.txt`)
    useRealExecutor(executor)

    const workflow = workflowStore.createWorkflow({
      name: 'tree teardown script', profile: 'default',
      nodes: [{
        id: 'tree-1', type: 'script', data: {
          title: 'Tree', runtime: 'node',
          code: [
            `const fs = require('node:fs');`,
            `const { spawn } = require('node:child_process');`,
            `const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 250)'], { stdio: 'ignore' });`,
            `fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(grandchild.pid));`,
            `fs.writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));`,
            `setInterval(() => {}, 250);`,
          ].join(''),
        },
      }],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id, { timeoutMs: 1500 })

    expect(result.run.status).toBe('failed')
    expect(result.run.error).toBe('workflow run timed out after 1500ms')
    const row = result.nodeSessions.find(session => session.node_id === 'tree-1')!
    expect(row.status).toBe('failed')
    expect(row.error).toBe('workflow run timed out after 1500ms')

    const childPid = Number(readFileSync(childPidPath, 'utf8'))
    const grandchildPid = Number(readFileSync(grandchildPidPath, 'utf8'))
    expect(childPid).toBeGreaterThan(0)
    expect(grandchildPid).toBeGreaterThan(0)
    await waitFor(() => !isProcessAlive(childPid) && !isProcessAlive(grandchildPid), 10000, 'the whole script process tree to exit')
    expect(isProcessAlive(childPid)).toBe(false)
    expect(isProcessAlive(grandchildPid)).toBe(false)
  })

  it('fails script nodes with a structured error when stdout or stderr crosses the output limit', async () => {
    const { executor } = await importManagerUnderTest()
    const baseRequest = {
      workflowId: 'wf-limit', runId: 'run-limit', nodeType: 'script',
      data: {}, input: '', timeoutMs: 60000, workspace: null,
    }
    const megabyteX = '"x".repeat(1024 * 1024)'
    const megabyteY = '"y".repeat(1024 * 1024)'

    const startedAt = Date.now()
    await expect(executor.executeWorkflowDeterministicNode({
      ...baseRequest, nodeId: 'burst-stdout', title: 'BurstStdout',
      data: { code: `for (let i = 0; i < 8; i += 1) console.log(${megabyteX})` },
    })).rejects.toThrow(/output limit exceeded on stdout \(limit 5242880 bytes per stream\)/)
    // The limit must terminate the process long before the 60s timeout backstop.
    expect(Date.now() - startedAt).toBeLessThan(30000)

    await expect(executor.executeWorkflowDeterministicNode({
      ...baseRequest, nodeId: 'burst-stderr', title: 'BurstStderr',
      data: { code: `for (let i = 0; i < 8; i += 1) console.error(${megabyteY})` },
    })).rejects.toThrow(/output limit exceeded on stderr \(limit 5242880 bytes per stream\)/)
  })

  it('accepts only one of two concurrent reruns and stamps a unique random execution scope', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const runStore = await import('../../packages/server/src/modules/studio/repositories/workflow-run-store')
    chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
    deterministicExecutorMock.run.mockResolvedValueOnce({ output: 'FIRST' })

    const workflow = workflowStore.createWorkflow({
      name: 'rerun race', profile: 'default',
      nodes: [{ id: 'solo', type: 'script', data: { title: 'Solo', runtime: 'node', code: 'console.log(1)' } }],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    const first = await instance.runNow(workflow.id)
    expect(first.run.status).toBe('completed')

    let release!: () => void
    const held = new Promise<{ ok: true; output: string }>(resolve => { release = () => resolve({ ok: true, output: 'rerun' }) })
    deterministicExecutorMock.run.mockImplementation(() => held)

    const rerunPromise = instance.rerunFromNode(workflow.id, first.run.id, 'solo')
    await vi.waitFor(() => expect(instance.getRuntimeStatus(workflow.id).status).toBe('running'))
    await expect(instance.rerunFromNode(workflow.id, first.run.id, 'solo')).rejects.toThrow('still active')
    release()
    await expect(rerunPromise).resolves.toMatchObject({ run: { status: 'completed' } })

    const rerunRows = runStore.listWorkflowRunNodeSessions(first.run.id).filter(row => row.execution_id.includes('@rerun:'))
    expect(rerunRows.length).toBeGreaterThan(0)
    const scope = (rerunRows[0].iteration_path as Array<{ executionScope?: string }>)[0]?.executionScope
    // The scope is a unique random token (UUID), never a millisecond timestamp.
    expect(scope).toMatch(/^rerun:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(scope).not.toMatch(/^rerun:\d+$/)
    expect(rerunRows.every(row => row.execution_id.includes(String(scope)))).toBe(true)
  })
})
