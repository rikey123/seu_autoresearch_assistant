import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Template-level end-to-end run for the overnight-research template: the
// template is instantiated as a Studio workflow and executed through the REAL
// WorkflowManager scheduler. Only the agent/chat layer is mocked (deterministic
// canned JSONL output for the batch executor); the queue intake, batch
// aggregation, and morning report script nodes run through the real
// deterministic executor (real `node -e` subprocesses, real stdin/stdout
// plumbing, real morning-report.html written to disk).
const originalE2eDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalE2eWebUiHome = process.env.HERMES_WEB_UI_HOME
const originalE2eStateDir = process.env.HERMES_WEBUI_STATE_DIR
const e2eTestRoot = mkdtempSync(join(tmpdir(), 'research-overnight-research-e2e-'))
const e2eTestDbDir = join(e2eTestRoot, 'db')
const e2eTestHome = join(e2eTestRoot, 'home')
process.env.HERMES_WEB_UI_TEST_DB_DIR = e2eTestDbDir
process.env.HERMES_WEB_UI_HOME = e2eTestHome
process.env.HERMES_WEBUI_STATE_DIR = e2eTestHome

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const chatRunMock = vi.hoisted(() => ({
  runAndWait: vi.fn(),
  abortSession: vi.fn(),
  sessionOutputs: new Map<string, string>(),
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

// Agent/chat runs are mocked; deterministic script dispatch forwards to the
// real deterministic executor so template script nodes execute as real
// `node -e` subprocesses exactly like in production.
vi.mock('../../packages/server/src/modules/studio/public/workflow-runtime', async () => {
  const executor = await import('../../packages/server/src/modules/studio/services/workflow/deterministic-executor')
  return {
    isWorkflowRunCoordinatorAvailable: () => true,
    runWorkflowAndWait: (input: Record<string, unknown>, options: Record<string, unknown>) => chatRunMock.runAndWait(input, options),
    abortWorkflowSession: (sessionId: string, reason: string) => chatRunMock.abortSession(sessionId, reason),
    stopWorkflowAgentRun: vi.fn(),
    deleteWorkflowPrimaryAgentSession: vi.fn(async () => true),
    getWorkflowAvailableModelGroups: vi.fn(async () => []),
    runWorkflowDeterministicNode: (request: Record<string, unknown>) =>
      executor.executeWorkflowDeterministicNode(request as Parameters<typeof executor.executeWorkflowDeterministicNode>[0]),
  }
})

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

import { getResearchWorkflowTemplate } from '../../packages/server/src/modules/research/workflows/template-service'

// Canned agent output for the batch executor: one strict JSON line per queue
// item (4 success, 1 failed with a reason), exactly the contract the node
// prompt demands. The morning report must render these without any engine
// wrapper lines leaking in.
const BATCH_EXECUTOR_OUTPUT = [
  JSON.stringify({ id: 'q-001', status: 'success', summary: 'Transformer 架构要点摘要' }),
  JSON.stringify({ id: 'q-002', status: 'success', summary: 'BERT 预训练要点摘要' }),
  JSON.stringify({ id: 'q-003', status: 'success', summary: '训练完成，loss 收敛' }),
  JSON.stringify({ id: 'q-004', status: 'failed', summary: '评估中断', reason: '训练数据缺失' }),
  JSON.stringify({ id: 'q-005', status: 'success', summary: 'GPT-3 缩放要点摘要' }),
].join('\n')

// Queue fixture: 9 physical lines — 5 valid unique items, 1 duplicate id, one
// non-JSON line, one item without id, and one blank line (plus the trailing
// newline every text file ends with).
const QUEUE_LINES = [
  JSON.stringify({ id: 'q-001', type: 'literature', payload: { title: 'Attention Is All You Need', query: 'transformer' } }),
  JSON.stringify({ id: 'q-002', type: 'literature', payload: { title: 'BERT', query: 'pretraining' } }),
  JSON.stringify({ id: 'q-002', type: 'literature', payload: { title: 'BERT duplicate', query: 'pretraining' } }),
  '',
  JSON.stringify({ id: 'q-003', type: 'experiment', payload: { cmd: 'train', epochs: 3 } }),
  'not-json-at-all',
  JSON.stringify({ id: 'q-004', type: 'experiment', payload: { cmd: 'eval', dataset: 'heldout' } }),
  JSON.stringify({ id: 'q-005', type: 'literature', payload: { title: 'GPT-3', query: 'scaling' } }),
  JSON.stringify({ type: 'experiment', payload: {} }),
]

function parseNodeOutput(row: { output_json: string }): Record<string, unknown> {
  return JSON.parse(row.output_json) as Record<string, unknown>
}

function nodeRow(result: { nodeSessions: Array<{ node_id: string }> }, nodeId: string): { node_id: string; session_id: string; status: string; output_json: string; error: string | null } {
  const row = result.nodeSessions.filter(session => session.node_id === nodeId).at(-1)
  expect(row, `node ${nodeId} must have a run session row`).toBeTruthy()
  return row as never
}

async function importE2eModules() {
  return {
    manager: await import('../../packages/server/src/modules/studio/services/workflow/manager'),
    workflowStore: await import('../../packages/server/src/modules/studio/repositories/workflow-store'),
  }
}

beforeAll(async () => {
  const { initAllStores } = await import('../../packages/server/src/modules/studio/infrastructure/database/init')
  initAllStores()
})

beforeEach(() => {
  chatRunMock.runAndWait.mockReset()
  chatRunMock.abortSession.mockReset()
  chatRunMock.sessionOutputs.clear()
  sessionStoreMock.createSession.mockClear()
  chatRunMock.runAndWait.mockImplementation(async (input: { session_id: string; input: string }) => {
    if (!String(input.input).includes('过夜批处理执行助手')) {
      throw new Error(`unexpected agent node input: ${String(input.input).slice(0, 160)}`)
    }
    chatRunMock.sessionOutputs.set(input.session_id, BATCH_EXECUTOR_OUTPUT)
    return { ok: true, output: BATCH_EXECUTOR_OUTPUT }
  })
})

afterAll(async () => {
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
  closeDb()
  restoreEnvironmentVariable('HERMES_WEB_UI_TEST_DB_DIR', originalE2eDbDir)
  restoreEnvironmentVariable('HERMES_WEB_UI_HOME', originalE2eWebUiHome)
  restoreEnvironmentVariable('HERMES_WEBUI_STATE_DIR', originalE2eStateDir)
  rmSync(e2eTestRoot, { recursive: true, force: true })
})

describe('overnight-research template end-to-end run (real engine)', () => {
  it('consumes the JSONL queue and lands a morning report HTML on disk', async () => {
    const { manager, workflowStore } = await importE2eModules()
    const template = getResearchWorkflowTemplate('overnight-research')!

    const orRunDir = join(e2eTestRoot, 'or-run')
    mkdirSync(orRunDir, { recursive: true })
    const queuePath = join(orRunDir, 'queue.jsonl')
    writeFileSync(queuePath, QUEUE_LINES.join('\n') + '\n', 'utf8')

    // Template instantiation; the entry node's authored input carries the
    // queue path and the batch size, exactly like a user filling in the
    // workflow before pressing run.
    const nodes = template.nodes.map(node => node.id === 'or-queue-intake'
      ? { ...node, data: { ...node.data, input: JSON.stringify({ queuePath, batchSize: 2 }) } }
      : node)
    const workflow = workflowStore.createWorkflow({
      name: 'e2e overnight research',
      profile: template.profile,
      nodes,
      edges: template.edges,
    })

    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)

    // The full pipeline (3 real script subprocesses + 1 mocked agent node)
    // completed, including the diamond join at or-batch-aggregate.
    expect(result.run.status).toBe('completed')
    expect(result.run.error).toBeNull()
    for (const nodeId of template.nodes.map(node => node.id)) {
      expect(nodeRow(result, nodeId).status, nodeId).toBe('completed')
    }

    // Only or-batch-executor is an agent node; script nodes never create chat
    // sessions.
    expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(1)
    expect(sessionStoreMock.createSession).toHaveBeenCalledTimes(1)
    const executorCall = chatRunMock.runAndWait.mock.calls[0][0]
    expect(String(executorCall.input)).toContain('[Current task]')
    expect(String(executorCall.input)).toContain('过夜批处理执行助手')
    // The queue plan reached the agent through the intake edge.
    expect(String(executorCall.input)).toContain('[Upstream: 队列接入]')
    expect(String(executorCall.input)).toContain('"batchSize":2')
    const executorRow = nodeRow(result, 'or-batch-executor')
    expect(executorRow.session_id).not.toBe('')

    // Intake validated/deduped/batched the queue through a real subprocess.
    const plan = parseNodeOutput(nodeRow(result, 'or-queue-intake'))
    expect(plan).toMatchObject({
      queuePath,
      batchSize: 2,
      totals: { lines: 8, blank: 1, valid: 5, duplicates: 1, invalid: 2 },
      duplicateIds: ['q-002'],
      batchCount: 3,
    })

    // Aggregation reconciled the agent output against the plan.
    const ledger = parseNodeOutput(nodeRow(result, 'or-batch-aggregate'))
    expect(ledger.stats).toEqual({ total: 5, success: 4, failed: 1, missing: 0, completionRate: 80 })
    expect(ledger.failures).toEqual([
      { id: 'q-004', type: 'experiment', batchIndex: 2, status: 'failed', reason: '训练数据缺失' },
    ])
    expect(ledger.unexpected).toEqual([])

    // The morning report landed on disk next to the queue file and carries the
    // batch statistics, every per-item result, the failure reasons, and the
    // next-step placeholder — with no engine wrapper line leaking in.
    const report = parseNodeOutput(nodeRow(result, 'or-morning-report'))
    expect(report).toMatchObject({
      format: 'html',
      title: '过夜自主科研晨报',
      stats: { total: 5, success: 4, failed: 1, missing: 0, completionRate: 80 },
    })
    const reportPath = String(report.reportPath)
    expect(reportPath).toBe(join(orRunDir, 'morning-report.html'))
    expect(existsSync(reportPath)).toBe(true)
    const html = readFileSync(reportPath, 'utf8')
    expect(html).toContain('<h1>过夜自主科研晨报</h1>')
    expect(html).toContain('<h2>一、批处理统计</h2>')
    expect(html).toContain('<td>80%</td>')
    expect(html).toContain('重复剔除的条目 id：q-002')
    expect(html).toContain('<h2>二、逐项结果清单</h2>')
    // The queue was fully consumed: every valid item id is listed.
    for (const itemId of ['q-001', 'q-002', 'q-003', 'q-004', 'q-005']) {
      expect(html).toContain(`<td>${itemId}</td>`)
    }
    expect(html).toContain('<td class="status-failed">失败</td>')
    expect(html).toContain('<h2>三、失败项与原因</h2>')
    expect(html).toContain('训练数据缺失')
    expect(html).toContain('<h2>四、下一步建议</h2>')
    expect(html).toContain('（占位）')
    expect(html).not.toContain('[Workflow upstream results]')
    expect(html).not.toContain('[Upstream:')
    expect(html).not.toContain('[Current task]')
    expect(html).not.toContain('Execute the current workflow node.')
  }, 60000)
})
