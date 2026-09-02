import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Focused unit coverage for the overnight-research template's deterministic
// script nodes. Each embedded node script is executed exactly the way the
// engine's deterministic executor runs it (real `node -e` subprocess, wrapped
// engine message on stdin, single JSON line on stdout) but without the engine
// scheduler, so queue semantics (validate/dedupe/batch), aggregation
// accounting, and morning-report rendering are pinned down in isolation.
import { getResearchWorkflowTemplate } from '../../packages/server/src/modules/research/workflows/template-service'

const testRoot = mkdtempSync(join(tmpdir(), 'overnight-research-template-'))

const template = getResearchWorkflowTemplate('overnight-research')
if (!template) throw new Error('overnight-research template must be registered')

function scriptCode(nodeId: string): string {
  const node = template!.nodes.find(candidate => candidate.id === nodeId)
  if (!node || node.type !== 'script') throw new Error(`node ${nodeId} must be a script node`)
  return node.data.code as string
}

function runNodeScript(nodeId: string, stdin: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['-e', scriptCode(nodeId)], {
    input: stdin,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

function expectSuccess(nodeId: string, stdin: string): Record<string, unknown> {
  const result = runNodeScript(nodeId, stdin)
  expect(result.status, `node ${nodeId} must exit 0 (stderr: ${result.stderr})`).toBe(0)
  const lines = result.stdout.trim().split(/\r?\n/)
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
}

function expectFailure(nodeId: string, stdin: string): string {
  const result = runNodeScript(nodeId, stdin)
  expect(result.status, `node ${nodeId} must exit non-zero`).not.toBe(0)
  return result.stderr
}

// Mirrors WorkflowManager.buildNodeUserMessage: the engine wraps the entry
// node's authored input in a "[Current task]" section, and downstream nodes get
// one "[Upstream: <title>]" section per incoming edge before "[Current task]".
function wrapEntryTask(authoredInput: string): string {
  return `[Current task]\n${authoredInput}`
}

function wrapUpstreams(upstreams: Array<{ title: string; content: string }>): string {
  const parts = ['[Workflow upstream results]']
  for (const upstream of upstreams) {
    parts.push(`\n[Upstream: ${upstream.title}]\n${upstream.content}`)
  }
  parts.push('\n[Current task]\nExecute the current workflow node.')
  return parts.join('\n').trim()
}

// Queue fixture: 9 physical lines — 5 valid unique items, 1 duplicate id, one
// non-JSON line, one item without id, and one blank line.
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

let queuePath = ''

beforeAll(() => {
  queuePath = join(testRoot, 'queue.jsonl')
  writeFileSync(queuePath, QUEUE_LINES.join('\n') + '\n', 'utf8')
})

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function intakeInput(batchSize: number): string {
  return wrapEntryTask(JSON.stringify({ queuePath, batchSize }))
}

function runIntake(batchSize: number): Record<string, unknown> {
  return expectSuccess('or-queue-intake', intakeInput(batchSize))
}

describe('overnight-research queue intake (or-queue-intake)', () => {
  it('validates, dedupes, and batches the JSONL queue deterministically', () => {
    const plan = runIntake(2)
    expect(plan).toMatchObject({
      queuePath,
      batchSize: 2,
      totals: { lines: 8, blank: 1, valid: 5, duplicates: 1, invalid: 2 },
      duplicateIds: ['q-002'],
      invalidLines: [
        { line: 6, reason: 'line is not a JSON object' },
        { line: 9, reason: 'item.id must be a non-empty string' },
      ],
      batchCount: 3,
    })
    // Batching preserves queue order and keeps the first occurrence of a
    // duplicated id with its original payload.
    const batches = plan.batches as Array<{ batchIndex: number; itemIds: string[]; items: Array<{ id: string; payload: unknown }> }>
    expect(batches.map(batch => batch.itemIds)).toEqual([['q-001', 'q-002'], ['q-003', 'q-004'], ['q-005']])
    expect(batches.map(batch => batch.batchIndex)).toEqual([1, 2, 3])
    expect(batches[0].items[1].payload).toEqual({ title: 'BERT', query: 'pretraining' })
    expect(plan.items).toEqual([
      { id: 'q-001', type: 'literature', batchIndex: 1 },
      { id: 'q-002', type: 'literature', batchIndex: 1 },
      { id: 'q-003', type: 'experiment', batchIndex: 2 },
      { id: 'q-004', type: 'experiment', batchIndex: 2 },
      { id: 'q-005', type: 'literature', batchIndex: 3 },
    ])
    // Deterministic: identical queue produces byte-identical plans.
    expect(runIntake(2)).toEqual(plan)
  })

  it('honors the default batch size and a bare absolute path input', () => {
    const plan = runIntake(3)
    expect(plan.batchSize).toBe(3)
    expect(plan.batchCount).toBe(2)
    const bare = expectSuccess('or-queue-intake', wrapEntryTask(queuePath))
    expect(bare.batchSize).toBe(3)
    expect(bare.batchCount).toBe(2)
  })

  it('rejects relative paths, missing files, and invalid batch sizes with a clear stderr', () => {
    expect(expectFailure('or-queue-intake', wrapEntryTask('relative/queue.jsonl'))).toContain('queuePath must be an absolute path')
    expect(expectFailure('or-queue-intake', wrapEntryTask(join(testRoot, 'missing.jsonl')))).toContain('queue file not found')
    expect(expectFailure('or-queue-intake', wrapEntryTask(JSON.stringify({ queuePath, batchSize: 0 })))).toContain('batchSize must be a positive integer')
    expect(expectFailure('or-queue-intake', wrapEntryTask(JSON.stringify({ queuePath, batchSize: 1.5 })))).toContain('batchSize must be a positive integer')
    expect(expectFailure('or-queue-intake', '')).toContain('queue intake node received no input')
  })
})

const FULL_RESULTS = [
  JSON.stringify({ id: 'q-001', status: 'success', summary: 'Transformer 要点摘要' }),
  JSON.stringify({ id: 'q-002', status: 'success', summary: 'BERT 要点摘要' }),
  JSON.stringify({ id: 'q-003', status: 'success', summary: '训练完成，loss 收敛' }),
  JSON.stringify({ id: 'q-004', status: 'failed', summary: '评估中断', reason: '训练数据缺失' }),
  JSON.stringify({ id: 'q-005', status: 'success', summary: 'GPT-3 要点摘要' }),
].join('\n')

function aggregateStdin(plan: Record<string, unknown>, agentOutput: string): string {
  return wrapUpstreams([
    { title: '队列接入', content: JSON.stringify(plan) },
    { title: '批处理执行', content: agentOutput },
  ])
}

describe('overnight-research batch aggregation (or-batch-aggregate)', () => {
  it('joins the plan with the agent output into an audited ledger', () => {
    const plan = runIntake(2)
    const ledger = expectSuccess('or-batch-aggregate', aggregateStdin(plan, FULL_RESULTS))
    expect(ledger.queue).toMatchObject({
      queuePath,
      batchSize: 2,
      batchCount: 3,
      totals: { lines: 8, blank: 1, valid: 5, duplicates: 1, invalid: 2 },
      duplicateIds: ['q-002'],
    })
    expect(ledger.stats).toEqual({ total: 5, success: 4, failed: 1, missing: 0, completionRate: 80 })
    expect(ledger.items).toEqual([
      { id: 'q-001', type: 'literature', batchIndex: 1, status: 'success', summary: 'Transformer 要点摘要' },
      { id: 'q-002', type: 'literature', batchIndex: 1, status: 'success', summary: 'BERT 要点摘要' },
      { id: 'q-003', type: 'experiment', batchIndex: 2, status: 'success', summary: '训练完成，loss 收敛' },
      { id: 'q-004', type: 'experiment', batchIndex: 2, status: 'failed', summary: '评估中断', reason: '训练数据缺失' },
      { id: 'q-005', type: 'literature', batchIndex: 3, status: 'success', summary: 'GPT-3 要点摘要' },
    ])
    expect(ledger.failures).toEqual([
      { id: 'q-004', type: 'experiment', batchIndex: 2, status: 'failed', reason: '训练数据缺失' },
    ])
    expect(ledger.unexpected).toEqual([])
  })

  it('accounts for missing, unexpected, and unknown-status results instead of dropping them', () => {
    const plan = runIntake(2)
    // q-005 is never reported (missing), q-003 reports an unknown status
    // (accounted as failed), and q-999 is not part of the plan (unexpected).
    const partial = [
      JSON.stringify({ id: 'q-001', status: 'success', summary: 'Transformer 要点摘要' }),
      JSON.stringify({ id: 'q-002', status: 'success', summary: 'BERT 要点摘要' }),
      JSON.stringify({ id: 'q-003', status: 'paused', summary: '状态不明确' }),
      JSON.stringify({ id: 'q-004', status: 'failed', summary: '评估中断', reason: '训练数据缺失' }),
      JSON.stringify({ id: 'q-999', status: 'success', summary: '计划外输出' }),
    ].join('\n')
    const ledger = expectSuccess('or-batch-aggregate', aggregateStdin(plan, partial))
    expect(ledger.stats).toEqual({ total: 5, success: 2, failed: 2, missing: 1, completionRate: 40 })
    const items = ledger.items as Array<{ id: string; status: string; reason?: string }>
    expect(items.find(item => item.id === 'q-005')).toMatchObject({
      status: 'missing',
      reason: '上游批处理节点未返回该条目的结果',
    })
    expect(items.find(item => item.id === 'q-003')).toMatchObject({ status: 'failed', reason: '未知状态: paused' })
    expect(ledger.failures).toHaveLength(3)
    expect(ledger.unexpected).toEqual([{ id: 'q-999', reason: '上游返回了计划之外的结果' }])
  })

  it('parses result lines tolerantly (bullets and code fences are ignored)', () => {
    const plan = runIntake(2)
    const fenced = [
      '```json',
      ...FULL_RESULTS.split('\n').map(line => `- ${line}`),
      '```',
    ].join('\n')
    const ledger = expectSuccess('or-batch-aggregate', aggregateStdin(plan, fenced))
    expect(ledger.stats).toEqual({ total: 5, success: 4, failed: 1, missing: 0, completionRate: 80 })
    expect(ledger.unexpected).toEqual([])
  })

  it('fails loudly when no queue plan section reaches the node', () => {
    expect(expectFailure(
      'or-batch-aggregate',
      wrapUpstreams([{ title: '批处理执行', content: FULL_RESULTS }]),
    )).toContain('aggregate node could not find the queue plan JSON')
  })
})

describe('overnight-research morning report (or-morning-report)', () => {
  it('writes the morning report HTML with stats, per-item results, failures, and the next-step placeholder', () => {
    const plan = runIntake(2)
    const ledger = expectSuccess('or-batch-aggregate', aggregateStdin(plan, FULL_RESULTS))
    const report = expectSuccess('or-morning-report', wrapUpstreams([
      { title: '逐批聚合', content: JSON.stringify(ledger) },
    ]))

    expect(report).toMatchObject({
      format: 'html',
      title: '过夜自主科研晨报',
      stats: { total: 5, success: 4, failed: 1, missing: 0, completionRate: 80 },
    })
    const reportPath = String(report.reportPath)
    expect(reportPath).toBe(join(testRoot, 'morning-report.html'))
    expect(existsSync(reportPath)).toBe(true)
    expect(Number(report.bytes)).toBeGreaterThan(0)

    const html = readFileSync(reportPath, 'utf8')
    expect(html).toContain('<h1>过夜自主科研晨报</h1>')
    expect(html).toContain('<h2>一、批处理统计</h2>')
    expect(html).toContain('<h2>二、逐项结果清单</h2>')
    expect(html).toContain('<h2>三、失败项与原因</h2>')
    expect(html).toContain('<h2>四、下一步建议</h2>')
    expect(html).toContain('（占位）')
    // Key batch statistics.
    expect(html).toContain('<td>80%</td>')
    expect(html).toContain('重复剔除的条目 id：q-002')
    expect(html).toContain('第 6 行（line is not a JSON object）')
    // Every consumed queue item is listed with its status.
    for (const itemId of ['q-001', 'q-002', 'q-003', 'q-004', 'q-005']) {
      expect(html).toContain(`<td>${itemId}</td>`)
    }
    expect(html).toContain('训练数据缺失')
    expect(html).toContain('<td class="status-failed">失败</td>')
    // Engine wrapper lines must never leak into the artifact.
    expect(html).not.toContain('[Workflow upstream results]')
    expect(html).not.toContain('[Upstream:')
    expect(html).not.toContain('[Current task]')
    expect(html).not.toContain('Execute the current workflow node.')
  })

  it('renders the no-failure variant and rejects non-ledger input', () => {
    const plan = runIntake(2)
    const successOnly = FULL_RESULTS.split('\n')
      .map(line => (line.includes('"id":"q-004"')
        ? JSON.stringify({ id: 'q-004', status: 'success', summary: '评估通过' })
        : line))
      .join('\n')
    const ledger = expectSuccess('or-batch-aggregate', aggregateStdin(plan, successOnly))
    expect(ledger.stats).toEqual({ total: 5, success: 5, failed: 0, missing: 0, completionRate: 100 })
    const report = expectSuccess('or-morning-report', wrapUpstreams([
      { title: '逐批聚合', content: JSON.stringify(ledger) },
    ]))
    const html = readFileSync(String(report.reportPath), 'utf8')
    expect(html).toContain('本次运行无失败项。')

    expect(expectFailure('or-morning-report', wrapEntryTask('not a ledger')))
      .toContain('morning report node expects the aggregation ledger JSON')
  })
})
