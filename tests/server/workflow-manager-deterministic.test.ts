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

/**
 * Delegating spies on the run-store so individual tests can simulate a
 * persistence failure, a disappeared row, or a changed run between rerun
 * preflight reads while every other call keeps the real store behavior.
 */
const runStoreSpies = vi.hoisted(() => ({
  getWorkflowRun: null as null | ReturnType<typeof vi.fn>,
  updateWorkflowRunNodeSession: null as null | ReturnType<typeof vi.fn>,
}))

/**
 * The SQLite-backed real implementations, captured on the FIRST load of the
 * mocked run-store. The static vi.mock factory effectively runs once (Vitest
 * caches the mocked instance across vi.resetModules), so `??=` keeps these
 * bound to the real database-backed store no matter what the JSON-fallback
 * test rebinds later.
 */
const runStoreSqlite = vi.hoisted(() => ({
  getWorkflowRun: null as null | ((id: string) => any),
  updateWorkflowRunNodeSession: null as null | ((id: string, patch: unknown) => any),
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

vi.mock('../../packages/server/src/modules/studio/repositories/workflow-run-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/server/src/modules/studio/repositories/workflow-run-store')>()
  const getWorkflowRun = runStoreSpies.getWorkflowRun ??= vi.fn(actual.getWorkflowRun)
  const updateWorkflowRunNodeSession = runStoreSpies.updateWorkflowRunNodeSession ??= vi.fn(actual.updateWorkflowRunNodeSession)
  // Rebinding keeps the spies delegating to the freshest actual implementation,
  // which matters for the JSON-fallback test that re-imports these modules.
  runStoreSqlite.getWorkflowRun ??= actual.getWorkflowRun
  runStoreSqlite.updateWorkflowRunNodeSession ??= actual.updateWorkflowRunNodeSession
  getWorkflowRun.mockImplementation(actual.getWorkflowRun)
  updateWorkflowRunNodeSession.mockImplementation(actual.updateWorkflowRunNodeSession)
  return {
    ...actual,
    getWorkflowRun,
    updateWorkflowRunNodeSession,
  }
})

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

beforeEach(async () => {
  chatRunMock.runAndWait.mockReset()
  chatRunMock.abortSession.mockReset()
  chatRunMock.sessionOutputs.clear()
  deterministicExecutorMock.run.mockReset()
  sessionStoreMock.createSession.mockClear()
  // Restore the delegating run-store spies so per-test overrides never leak into
  // the next test. The vi.mock factory rebinds the underlying real functions on
  // every module load; here we only restore call history and default behavior.
  await import('../../packages/server/src/modules/studio/repositories/workflow-run-store')
  runStoreSpies.getWorkflowRun?.mockReset().mockImplementation(runStoreSqlite.getWorkflowRun!)
  runStoreSpies.updateWorkflowRunNodeSession?.mockReset().mockImplementation(runStoreSqlite.updateWorkflowRunNodeSession!)
})

async function importManagerUnderTest() {
  return {
    manager: await import('../../packages/server/src/modules/studio/services/workflow/manager'),
    workflowStore: await import('../../packages/server/src/modules/studio/repositories/workflow-store'),
    executor: await import('../../packages/server/src/modules/studio/services/workflow/deterministic-executor'),
  }
}

async function importRunStoreUnderTest() {
  return import('../../packages/server/src/modules/studio/repositories/workflow-run-store')
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

describe('deterministic engine rerun guards', () => {
  it('rejects with 409 when the run changes between rerun preflight reads', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const runStore = await importRunStoreUnderTest()
    chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
    deterministicExecutorMock.run.mockResolvedValue({ output: 'SCRIPT-1' })

    const workflow = workflowStore.createWorkflow({
      name: 'preflight changed run', profile: 'default',
      nodes: [
        { id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } },
        { id: 'agent-1', type: 'agent', data: { title: 'Agent', agent: 'hermes', input: 'polish' } },
      ],
      edges: [{ id: 'e1', source: 'script-1', target: 'agent-1' }],
    })
    const instance = new manager.WorkflowManager()
    const first = await instance.runNow(workflow.id)
    expect(first.run.status).toBe('completed')

    // The first rerun read sees the persisted record; every later read simulates
    // a concurrent lifecycle change (e.g. another worker reset the run).
    let reads = 0
    const getWorkflowRunSpy = runStoreSpies.getWorkflowRun!
    getWorkflowRunSpy.mockImplementation((id: string) => {
      const record = runStoreSqlite.getWorkflowRun!(id)
      reads += 1
      if (reads > 1 && record) return { ...record, started_at: (record.started_at || 0) + 1000 }
      return record
    })
    try {
      await expect(instance.rerunFromNode(workflow.id, first.run.id, 'agent-1'))
        .rejects.toMatchObject({ status: 409, message: 'workflow run changed during rerun preflight' })
      // Fail closed: the terminal run is still completed and no new evidence was appended.
      expect(runStore.getWorkflowRun(first.run.id)!.status).toBe('completed')
      expect(runStore.listWorkflowRunNodeSessions(first.run.id)).toHaveLength(2)
      expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(1)
    } finally {
      getWorkflowRunSpy.mockReset()
      getWorkflowRunSpy.mockImplementation(runStoreSqlite.getWorkflowRun!)
    }
  })

  it('rejects with 409 when an upstream deterministic session row disappears before rerun', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const runStore = await importRunStoreUnderTest()
    chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
    deterministicExecutorMock.run.mockResolvedValue({ output: 'SCRIPT-1' })

    const workflow = workflowStore.createWorkflow({
      name: 'missing upstream session', profile: 'default',
      nodes: [
        { id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } },
        { id: 'agent-1', type: 'agent', data: { title: 'Agent', agent: 'hermes', input: 'polish' } },
      ],
      edges: [{ id: 'e1', source: 'script-1', target: 'agent-1' }],
    })
    const instance = new manager.WorkflowManager()
    const first = await instance.runNow(workflow.id)
    expect(first.run.status).toBe('completed')

    const scriptSessions = runStore.listWorkflowRunNodeSessions(first.run.id).filter(session => session.node_id === 'script-1')
    expect(scriptSessions).toHaveLength(1)
    const deleted = runStore.deleteWorkflowRunNodeSessions(first.run.id, ['script-1'])
    expect(deleted).toHaveLength(1)

    await expect(instance.rerunFromNode(workflow.id, first.run.id, 'agent-1'))
      .rejects.toMatchObject({ status: 409, message: 'Upstream node Script has no completed output' })
    // Fail closed: no new evidence and the run stays terminal.
    expect(runStore.getWorkflowRun(first.run.id)!.status).toBe('completed')
    expect(runStore.listWorkflowRunNodeSessions(first.run.id)).toHaveLength(1)
    expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(1)
  })
})

describe('deterministic executor and evidence edge cases', () => {
  const scriptNode = (id: string, title: string) => ({
    id, type: 'script', data: { title, runtime: 'node', code: 'console.log(1)' },
  })

  it('stringifies non-Error executor rejections without crashing the run', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    deterministicExecutorMock.run.mockRejectedValueOnce('kaputt-string')

    const workflow = workflowStore.createWorkflow({
      name: 'non error rejection string', profile: 'default',
      nodes: [scriptNode('script-1', 'String failure')],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toContain('kaputt-string')
    const row = result.nodeSessions.find(session => session.node_id === 'script-1')!
    expect(row.status).toBe('failed')
    expect(row.error).toBe('kaputt-string')
    expect(chatRunMock.runAndWait).not.toHaveBeenCalled()
    expect(sessionStoreMock.createSession).not.toHaveBeenCalled()

    // Promise rejection with no error payload at all must also stay structured.
    deterministicExecutorMock.run.mockRejectedValueOnce(undefined)
    const noPayloadWorkflow = workflowStore.createWorkflow({
      name: 'non error rejection undefined', profile: 'default',
      nodes: [scriptNode('script-2', 'Undefined failure')],
      edges: [],
    })
    const noPayloadResult = await instance.runNow(noPayloadWorkflow.id)
    expect(noPayloadResult.run.status).toBe('failed')
    expect(noPayloadResult.run.error).toContain('undefined')
    const noPayloadRow = noPayloadResult.nodeSessions.find(session => session.node_id === 'script-2')!
    expect(noPayloadRow.status).toBe('failed')
    expect(noPayloadRow.error).toBe('undefined')
  })

  it('fails the run when the node session completion update cannot be persisted', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const dbModule = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
    const db = dbModule.getDb()!
    // Any write that flips a running deterministic row to completed aborts,
    // simulating a disk/database failure at the persistence boundary.
    db.exec(`
      CREATE TRIGGER fail_deterministic_completion BEFORE UPDATE ON workflow_run_node_sessions
      WHEN NEW.status = 'completed' AND OLD.status = 'running'
      BEGIN SELECT RAISE(ABORT, 'node session persist failed'); END
    `)
    try {
      deterministicExecutorMock.run.mockResolvedValue({ output: 'SCRIPT-1' })
      const workflow = workflowStore.createWorkflow({
        name: 'session persist failure', profile: 'default',
        nodes: [scriptNode('script-1', 'Persist failure')],
        edges: [],
      })
      const instance = new manager.WorkflowManager()
      const result = await instance.runNow(workflow.id)
      expect(result.run.status).toBe('failed')
      expect(result.run.error).toContain('node session persist failed')
      const row = result.nodeSessions.find(session => session.node_id === 'script-1')!
      // The failure marker write succeeds (it never flips to completed), so the
      // operator-facing row keeps the persistence error.
      expect(row.status).toBe('failed')
      expect(row.error).toBe('node session persist failed')
      expect(row.output_json).toBe('')
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_deterministic_completion')
    }
  })

  it('tolerates a vanished node session row on the completion update without crashing', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const runStore = await importRunStoreUnderTest()
    deterministicExecutorMock.run.mockResolvedValue({ output: 'SCRIPT-1' })

    const workflow = workflowStore.createWorkflow({
      name: 'vanished session row', profile: 'default',
      nodes: [scriptNode('script-1', 'Vanished row')],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    // Simulate a concurrent delete of the node row between creation and the
    // completion write: the store no-ops (returns null) and the manager must
    // keep the execution result and close the run instead of crashing.
    runStoreSpies.updateWorkflowRunNodeSession!.mockImplementationOnce(() => null)
    const result = await instance.runNow(workflow.id)
    expect(result.run.status).toBe('completed')
    const row = result.nodeSessions.find(session => session.node_id === 'script-1')!
    // The row was never updated: it stays in its created running state with the
    // empty output default, which is the documented best-effort semantics.
    expect(row.status).toBe('running')
    expect(row.output_json).toBe('')
  })

  it('records success, failure, and always edge evidence from a deterministic node', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const runStore = await importRunStoreUnderTest()
    deterministicExecutorMock.run.mockImplementation(async (request: Record<string, unknown>) => ({ output: `OUT-${request.nodeId}` }))

    const workflow = workflowStore.createWorkflow({
      name: 'deterministic evidence matrix', profile: 'default',
      nodes: [
        scriptNode('probe', 'Probe'),
        scriptNode('ok-handler', 'OK handler'),
        scriptNode('failure-handler', 'Failure handler'),
        scriptNode('always-handler', 'Always handler'),
      ],
      edges: [
        { id: 'on-success', source: 'probe', target: 'ok-handler', data: { orchestration: { route: 'success' } } },
        { id: 'on-failure', source: 'probe', target: 'failure-handler', data: { orchestration: { route: 'failure' } } },
        { id: 'on-always', source: 'probe', target: 'always-handler', data: { orchestration: { route: 'always' } } },
      ],
    })
    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)
    expect(result.run.status).toBe('completed')

    const evidence = runStore.listWorkflowRunEdgeEvaluations(result.run.id)
      .filter(item => item.source_node_id === 'probe')
      .map(item => ({ edge: item.edge_id, status: item.status, reason: item.reason, outcome: item.source_outcome, route: item.route }))
      .sort((left, right) => left.edge.localeCompare(right.edge))
    expect(evidence).toEqual([
      { edge: 'on-always', status: 'taken', reason: null, outcome: 'success', route: 'always' },
      { edge: 'on-failure', status: 'not_taken', reason: 'route_not_matched', outcome: 'success', route: 'failure' },
      { edge: 'on-success', status: 'taken', reason: null, outcome: 'success', route: 'success' },
    ])
    // Only the taken routes dispatched their deterministic handlers.
    expect(result.nodeSessions.map(session => session.node_id).sort()).toEqual(['always-handler', 'ok-handler', 'probe'])
    expect(result.nodeSessions.find(session => session.node_id === 'ok-handler')!.output_json).toBe('OUT-ok-handler')
    expect(result.nodeSessions.find(session => session.node_id === 'always-handler')!.output_json).toBe('OUT-always-handler')
    expect(sessionStoreMock.createSession).not.toHaveBeenCalled()

    // Failing probe: the failure and always edges flip their dispatch, the
    // success route is skipped, and the run still closes with the node error.
    deterministicExecutorMock.run.mockReset()
    deterministicExecutorMock.run.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.nodeId === 'probe') throw new Error('probe exploded')
      return { output: `OUT-${request.nodeId}` }
    })
    const failingWorkflow = workflowStore.createWorkflow({
      name: 'deterministic evidence failure', profile: 'default',
      nodes: [
        scriptNode('probe', 'Probe'),
        scriptNode('ok-handler', 'OK handler'),
        scriptNode('failure-handler', 'Failure handler'),
        scriptNode('always-handler', 'Always handler'),
      ],
      edges: [
        { id: 'on-success', source: 'probe', target: 'ok-handler', data: { orchestration: { route: 'success' } } },
        { id: 'on-failure', source: 'probe', target: 'failure-handler', data: { orchestration: { route: 'failure' } } },
        { id: 'on-always', source: 'probe', target: 'always-handler', data: { orchestration: { route: 'always' } } },
      ],
    })
    const failingResult = await instance.runNow(failingWorkflow.id)
    expect(failingResult.run.status).toBe('failed')
    expect(failingResult.run.error).toContain('probe exploded')
    const failingEvidence = runStore.listWorkflowRunEdgeEvaluations(failingResult.run.id)
      .filter(item => item.source_node_id === 'probe')
      .map(item => ({ edge: item.edge_id, status: item.status, reason: item.reason, outcome: item.source_outcome }))
      .sort((left, right) => left.edge.localeCompare(right.edge))
    expect(failingEvidence).toEqual([
      { edge: 'on-always', status: 'taken', reason: null, outcome: 'failure' },
      { edge: 'on-failure', status: 'taken', reason: null, outcome: 'failure' },
      { edge: 'on-success', status: 'not_taken', reason: 'route_not_matched', outcome: 'failure' },
    ])
    expect(failingResult.nodeSessions.map(session => session.node_id).sort()).toEqual(['always-handler', 'failure-handler', 'probe'])
    expect(failingResult.nodeSessions.find(session => session.node_id === 'probe')!.error).toBe('probe exploded')
  })

  it('records deterministic node evidence inside a bounded feedback loop', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const runStore = await importRunStoreUnderTest()
    deterministicExecutorMock.run.mockImplementation(async (request: Record<string, unknown>) => ({ output: `OUT-${request.nodeId}` }))

    const workflow = workflowStore.createWorkflow({
      name: 'deterministic feedback loop', profile: 'default',
      nodes: [
        scriptNode('check', 'Check'),
        scriptNode('fix', 'Fix'),
      ],
      edges: [
        { id: 'forward', source: 'check', target: 'fix' },
        { id: 'retry', source: 'fix', target: 'check', data: { orchestration: { route: 'success', feedback: { maxIterations: 2 } } } },
      ],
    })
    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)
    expect(result.run.status).toBe('completed')

    expect(result.nodeSessions.map(session => [session.node_id, session.execution_id, session.iteration_path])).toEqual([
      ['check', 'check@loop:retry:0', [{ loopId: 'loop:retry', iteration: 0 }]],
      ['fix', 'fix@loop:retry:0', [{ loopId: 'loop:retry', iteration: 0 }]],
      ['check', 'check@loop:retry:1', [{ loopId: 'loop:retry', iteration: 1 }]],
      ['fix', 'fix@loop:retry:1', [{ loopId: 'loop:retry', iteration: 1 }]],
    ])
    expect(deterministicExecutorMock.run).toHaveBeenCalledTimes(4)
    expect(result.nodeSessions.every(session => session.output_json !== '')).toBe(true)

    expect(runStore.listWorkflowRunEdgeEvaluations(result.run.id).filter(item => item.edge_id === 'forward').map(item => ({
      source: item.source_execution_id, status: item.status, outcome: item.source_outcome, path: item.iteration_path,
    }))).toEqual([
      { source: 'check@loop:retry:0', status: 'taken', outcome: 'success', path: [{ loopId: 'loop:retry', iteration: 0 }] },
      { source: 'check@loop:retry:1', status: 'taken', outcome: 'success', path: [{ loopId: 'loop:retry', iteration: 1 }] },
    ])
    expect(runStore.listWorkflowRunEdgeEvaluations(result.run.id).filter(item => item.edge_id === 'retry').map(item => ({
      source: item.source_execution_id, status: item.status, reason: item.reason, path: item.iteration_path,
    }))).toEqual([
      { source: 'fix@loop:retry:0', status: 'taken', reason: null, path: [{ loopId: 'loop:retry', iteration: 0 }] },
      { source: 'fix@loop:retry:1', status: 'not_taken', reason: 'iteration_limit_reached', path: [{ loopId: 'loop:retry', iteration: 1 }] },
    ])
    expect(runStore.listWorkflowRunLoopEpochs(result.run.id).map(epoch => ({
      loopId: epoch.loop_id, iteration: epoch.iteration, status: epoch.status, exitReason: epoch.exit_reason,
    }))).toEqual([
      { loopId: 'loop:retry', iteration: 0, status: 'completed', exitReason: 'feedback_taken' },
      { loopId: 'loop:retry', iteration: 1, status: 'completed', exitReason: 'iteration_limit_reached' },
    ])
  })

  it('runs multiple ready deterministic nodes in parallel and collects every output', async () => {
    const { manager, workflowStore } = await importManagerUnderTest()
    const started: string[] = []
    const releaseAll: Array<() => void> = []
    deterministicExecutorMock.run.mockImplementation((request: Record<string, unknown>) => {
      started.push(String(request.nodeId))
      return new Promise(resolve => { releaseAll.push(() => resolve({ output: `OUT-${request.nodeId}` })) })
    })

    const workflow = workflowStore.createWorkflow({
      name: 'parallel deterministic start', profile: 'default',
      nodes: [scriptNode('a', 'Alpha'), scriptNode('b', 'Beta'), scriptNode('c', 'Gamma')],
      edges: [],
    })
    const instance = new manager.WorkflowManager()
    const runPromise = instance.runNow(workflow.id)
    // All three ready units must be dispatched before any of them settles; a
    // serial scheduler would only ever have one started request here.
    await vi.waitFor(() => expect(started).toHaveLength(3))
    expect(new Set(started)).toEqual(new Set(['a', 'b', 'c']))
    expect(releaseAll).toHaveLength(3)
    for (const release of releaseAll) release()
    const result = await runPromise
    expect(result.run.status).toBe('completed')
    expect(result.nodeSessions.map(session => session.node_id).sort()).toEqual(['a', 'b', 'c'])
    expect(result.nodeSessions.every(session => session.status === 'completed')).toBe(true)
    expect(result.nodeSessions.map(session => session.output_json).sort()).toEqual(['OUT-a', 'OUT-b', 'OUT-c'])
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

  it('stopRun without a deadline kills a long-running script process and lands its node row canceled', { timeout: 30_000 }, async () => {
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

  // Whole-tree teardown is a Windows-only guarantee (taskkill /T /F). The
  // POSIX branch of killOwnedProcessTree deliberately keeps the caller's
  // existing signal behavior: it signals only the direct child and reparented
  // grandchildren are not part of the documented contract (see
  // packages/server/src/modules/studio/infrastructure/process-tree.ts). The
  // direct-child kill path on POSIX is covered by the un-gated long-script
  // test above; the platform matrix of the fallback itself is unit-covered in
  // tests/server/process-tree.test.ts.
  it.runIf(process.platform === 'win32')('run deadline after a script spawned a grandchild tears down the whole process tree', { timeout: 30_000 }, async () => {
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

  it('fails script nodes with a structured error when stdout or stderr crosses the output limit', { timeout: 30_000 }, async () => {
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

describe('deterministic engine JSON store fallback', () => {
  const databaseIndexPath = '../../packages/server/src/modules/studio/infrastructure/database/index'
  const runStorePath = '../../packages/server/src/modules/studio/repositories/workflow-run-store'

  it('reruns through the CAS JSON reset when SQLite is unavailable', { timeout: 30_000 }, async () => {
    // The rest of this suite runs on SQLite; this test simulates an environment
    // where node:sqlite is unavailable (getDb() === null) and exercises the
    // read-compare-write fallback of resetTerminalRunForRerun end to end.
    // vi.doMock is required because Vitest caches the statically mocked
    // run-store instance across vi.resetModules; the doMock replaces it with a
    // fresh module whose database import resolves through the getDb override.
    const { closeDb } = await import(databaseIndexPath)
    closeDb()
    vi.resetModules()
    vi.doMock(databaseIndexPath, async (importOriginal) => {
      const actual = await importOriginal()
      return { ...actual, getDb: () => null }
    })
    vi.doMock(runStorePath, async (importOriginal) => {
      const actual = await importOriginal()
      const getWorkflowRun = runStoreSpies.getWorkflowRun ??= vi.fn(actual.getWorkflowRun)
      const updateWorkflowRunNodeSession = runStoreSpies.updateWorkflowRunNodeSession ??= vi.fn(actual.updateWorkflowRunNodeSession)
      getWorkflowRun.mockReset().mockImplementation(actual.getWorkflowRun)
      updateWorkflowRunNodeSession.mockReset().mockImplementation(actual.updateWorkflowRunNodeSession)
      return { ...actual, getWorkflowRun, updateWorkflowRunNodeSession }
    })
    try {
      const runStore = await import(runStorePath)
      const workflowStore = await import('../../packages/server/src/modules/studio/repositories/workflow-store')
      const { WorkflowManager } = await import('../../packages/server/src/modules/studio/services/workflow/manager')
      chatRunMock.runAndWait.mockResolvedValue({ ok: true, output: 'agent output' })
      deterministicExecutorMock.run.mockResolvedValueOnce({ output: 'JSON-1' })

      const workflow = workflowStore.createWorkflow({
        name: 'json fallback rerun', profile: 'default',
        nodes: [{ id: 'script-1', type: 'script', data: { title: 'Script', runtime: 'node', code: 'console.log(1)' } }],
        edges: [],
      })
      const instance = new WorkflowManager()
      const first = await instance.runNow(workflow.id)
      expect(first.run.status).toBe('completed')
      expect(first.nodeSessions).toHaveLength(1)
      expect(first.nodeSessions[0].output_json).toBe('JSON-1')

      deterministicExecutorMock.run.mockResolvedValueOnce({ output: 'JSON-2' })
      const rerun = await instance.rerunFromNode(workflow.id, first.run.id, 'script-1')
      expect(rerun.run.status).toBe('completed')
      const scriptRows = rerun.nodeSessions.filter(session => session.node_id === 'script-1')
      expect(scriptRows).toHaveLength(2)
      expect(scriptRows.at(-1)!.output_json).toBe('JSON-2')
      expect(scriptRows.at(-1)!.session_id).toBe('')
      // The terminal reset really flipped the stored row through the JSON store
      // (without allow_terminal_reset the CAS reset would have been rejected).
      expect(runStore.getWorkflowRun(first.run.id)!.status).toBe('completed')
      const rawJson = JSON.parse(readFileSync(join(deterministicTestDbDir, 'hermes-web-ui.json'), 'utf8'))
      expect(rawJson.workflow_runs[first.run.id].status).toBe('completed')
      expect(rawJson.workflow_run_node_sessions[scriptRows.at(-1)!.id].output_json).toBe('JSON-2')
    } finally {
      // Point the shared spies back at the SQLite-bound implementations and
      // restore the real module graph so the rest of the suite keeps its DB.
      runStoreSpies.getWorkflowRun?.mockReset().mockImplementation(runStoreSqlite.getWorkflowRun!)
      runStoreSpies.updateWorkflowRunNodeSession?.mockReset().mockImplementation(runStoreSqlite.updateWorkflowRunNodeSession!)
      vi.doUnmock(databaseIndexPath)
      vi.doUnmock(runStorePath)
      // Re-import the real database module and open a fresh connection on the
      // same test DB file so afterAll can close it and remove the temp tree.
      vi.resetModules()
      const { getDb } = await import(databaseIndexPath)
      getDb()
    }
  })
})
