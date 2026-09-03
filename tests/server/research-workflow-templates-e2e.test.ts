import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Template-level end-to-end run: registered research templates are
// instantiated as Studio workflows and executed through the REAL WorkflowManager
// scheduler. Only the agent/chat layer is mocked (deterministic canned outputs);
// script nodes run through the real deterministic executor (real `node -e`
// subprocesses, real stdin/stdout plumbing). The external pdf2zh binary is
// stubbed at the subprocess boundary with a Node wrapper script. The
// literature-review template binds the literature-review-outline skill: the
// workflow skill resolver is intentionally NOT mocked — it resolves the bound
// skill through the profile-config facade against the nature-research skill
// pack this test loads via the research skillpack route, proving the loaded
// pack is injected into the agent path (same mechanism as the figure-drawing
// e2e).
const originalE2eDbDir = process.env.HERMES_WEB_UI_TEST_DB_DIR
const originalE2eWebUiHome = process.env.HERMES_WEB_UI_HOME
const originalE2eStateDir = process.env.HERMES_WEBUI_STATE_DIR
const originalE2eHermesHome = process.env.HERMES_HOME
const originalE2eApiKey = process.env.OPENAI_API_KEY
const originalE2ePdf2zhBin = process.env.PAPER_TRANSLATE_PDF2ZH_BIN
const originalE2eAuthToken = process.env.AUTH_TOKEN
const e2eTestRoot = mkdtempSync(join(tmpdir(), 'research-workflow-templates-e2e-'))
const hermesRoot = join(e2eTestRoot, 'hermes-root')
const e2eTestDbDir = join(e2eTestRoot, 'db')
const e2eTestHome = join(e2eTestRoot, 'home')
process.env.HERMES_WEB_UI_TEST_DB_DIR = e2eTestDbDir
process.env.HERMES_WEB_UI_HOME = e2eTestHome
process.env.HERMES_WEBUI_STATE_DIR = e2eTestHome
process.env.HERMES_HOME = hermesRoot

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

// Agent/chat runs are mocked; deterministic script dispatch forwards to the
// real deterministic executor so template script nodes execute as real
// `node -e` subprocesses exactly like in production. The workflow skill
// resolver stays REAL: literature-review's bound literature-review-outline
// skill must resolve against the pack loaded below through the research
// skillpack route.
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

// Canned agent outputs. The markdown below doubles as engine-input fixtures:
// each entry feeds the next node through the engine's "[Upstream: ...]"
// packaging, so the final report script proves the wrapper stripping works.
const LR_SEARCH_OUTPUT = [
  '1. [1] Attention Is All You Need (2017), Vaswani et al., NeurIPS, https://arxiv.org/abs/1706.03762 — Transformer 架构',
  '2. [2] BERT (2019), Devlin et al., NAACL, https://arxiv.org/abs/1810.04805 — 预训练语言模型',
  '',
  '## 检索策略',
  '- 关键词：graph learning, transformer；数据源：arXiv。',
].join('\n')

const LR_SCREEN_OUTPUT = [
  '## 入选文献',
  '1. [1] Attention Is All You Need（入选：方法与结论明确）',
  '2. [2] BERT（入选：来源可信）',
].join('\n')

const LR_READ_OUTPUT = [
  '### [1] Attention Is All You Need',
  '- 研究问题：纯注意力能否替代循环结构',
  '- 核心结果：机器翻译 SOTA',
].join('\n')

const LR_DRAFT_OUTPUT = [
  '# 图学习文献综述（初稿）',
  '',
  '## 引言',
  '本综述梳理 **图神经网络** 的代表作。',
].join('\n')

const LR_CITE_CHECK_OUTPUT = [
  '# 图学习文献综述（引用核查版）',
  '',
  '## 摘要',
  '本综述梳理 *图神经网络* 的代表作与最新进展 [1]。',
  '',
  '## 引用核查说明',
  '- 修正文献 [2] 的发表年份。',
].join('\n')

const PT_GLOSSARY_OUTPUT = [
  '| 英文术语 | 中文译名 | 语境/备注 |',
  '| --- | --- | --- |',
  '| Transformer | 变换器 | 架构名，可保留原文 |',
].join('\n')

/** Maps a wrapped node user message to the canned output of its template node. */
function cannedOutputForNodeMessage(message: string): string {
  if (message.includes('文献检索助手')) return LR_SEARCH_OUTPUT
  if (message.includes('文献筛选助手')) return LR_SCREEN_OUTPUT
  if (message.includes('精读助手')) return LR_READ_OUTPUT
  if (message.includes('综述撰写助手')) return LR_DRAFT_OUTPUT
  if (message.includes('引用核查助手')) return LR_CITE_CHECK_OUTPUT
  if (message.includes('术语表管理员')) return PT_GLOSSARY_OUTPUT
  throw new Error(`unexpected agent node input: ${message.slice(0, 160)}`)
}

// Subprocess-boundary stub for the external pdf2zh CLI. It receives pdf2zh's
// exact argv contract (-i <pdf> -o <dir> -s openai -lo <lang>) and writes the
// two output files the translate node expects, without any real translation.
const PDF2ZH_STUB_CODE = [
  "'use strict';",
  'var args = process.argv.slice(2);',
  'function flagValue(name) { var index = args.indexOf(name); return index === -1 ? null : args[index + 1]; }',
  'var fs = require("node:fs");',
  'var path = require("node:path");',
  'var inPath = flagValue("-i");',
  'var outDir = flagValue("-o");',
  'if (!inPath || !outDir || !fs.existsSync(inPath)) {',
  '  console.error("pdf2zh-stub: expected -i <pdf> -o <dir>, received: " + JSON.stringify(args));',
  '  process.exit(1);',
  '}',
  'fs.mkdirSync(outDir, { recursive: true });',
  'var stem = path.basename(inPath).replace(/\\.pdf$/i, "");',
  'fs.writeFileSync(path.join(outDir, stem + "-mono.pdf"), "%PDF-1.4 stub mono");',
  'fs.writeFileSync(path.join(outDir, stem + "-dual.pdf"), "%PDF-1.4 stub dual");',
  'process.stdout.write("pdf2zh-stub: wrote translations to " + outDir);',
].join('\n')

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

let skillpackRoutes: typeof import('../../packages/server/src/modules/research/skillpacks/index')

/** Loads the nature-research pack through the HTTP route (full research surface). */
async function loadNatureResearchPack(): Promise<void> {
  const dispatchRoute = skillpackRoutes.skillpacksRoutes.routes()
  const ctx: any = {
    method: 'POST',
    path: '/api/studio/research/skillpacks/nature-research/load',
    query: {},
    params: { id: 'nature-research' },
    request: { body: {} },
    state: {},
    status: 200,
    body: undefined,
  }
  await dispatchRoute(ctx, async () => {})
  expect(ctx.status).toBe(200)
  expect(ctx.body.pack.loaded).toBe(true)
}

beforeAll(async () => {
  // Mirror the bootstrap wiring (agent-profile-adapter) against an isolated
  // HERMES_HOME so the skill loader and the engine's skill resolver agree on
  // the profile skills directory.
  const { configureProfileConfig } = await import('../../packages/server/src/modules/studio/public/profile-config')
  configureProfileConfig({
    buildModelGroups: () => ({ default: '', groups: [] }),
    getProfileDir: (profile: string) => {
      const root = process.env.HERMES_HOME || hermesRoot
      if (!profile || profile === 'default') return root
      const named = join(root, 'profiles', profile)
      return existsSync(named) ? named : root
    },
    getActiveProfileName: () => 'default',
    listProfileNames: () => ['default'],
    providerEnvironmentMap: {},
    readConfigYaml: async () => ({}),
    readConfigYamlForProfile: async () => ({}),
    safeReadFile: async (filePath: string) => {
      try { return readFileSync(filePath, 'utf-8') } catch { return null }
    },
    saveEnvValue: async () => {},
    saveEnvValueForProfile: async () => {},
    updateConfigYaml: async (updater: (config: Record<string, any>) => unknown) => updater({}),
    updateConfigYamlForProfile: async (_profile: string, updater: (config: Record<string, any>) => unknown) => updater({}),
  })
  const { initAllStores } = await import('../../packages/server/src/modules/studio/infrastructure/database/init')
  initAllStores()
  skillpackRoutes = await import('../../packages/server/src/modules/research/skillpacks/index')
  await loadNatureResearchPack()
})

beforeEach(() => {
  chatRunMock.runAndWait.mockReset()
  chatRunMock.abortSession.mockReset()
  chatRunMock.sessionOutputs.clear()
  sessionStoreMock.createSession.mockClear()
  chatRunMock.runAndWait.mockImplementation(async (input: { session_id: string; input: string }) => {
    const output = cannedOutputForNodeMessage(String(input.input))
    chatRunMock.sessionOutputs.set(input.session_id, output)
    return { ok: true, output }
  })
})

afterAll(async () => {
  const { closeDb } = await import('../../packages/server/src/modules/studio/infrastructure/database/index')
  closeDb()
  restoreEnvironmentVariable('HERMES_WEB_UI_TEST_DB_DIR', originalE2eDbDir)
  restoreEnvironmentVariable('HERMES_WEB_UI_HOME', originalE2eWebUiHome)
  restoreEnvironmentVariable('HERMES_WEBUI_STATE_DIR', originalE2eStateDir)
  restoreEnvironmentVariable('HERMES_HOME', originalE2eHermesHome)
  restoreEnvironmentVariable('OPENAI_API_KEY', originalE2eApiKey)
  restoreEnvironmentVariable('PAPER_TRANSLATE_PDF2ZH_BIN', originalE2ePdf2zhBin)
  restoreEnvironmentVariable('AUTH_TOKEN', originalE2eAuthToken)
  rmSync(e2eTestRoot, { recursive: true, force: true })
})

describe('research workflow template end-to-end runs (real engine)', () => {
  it('runs the literature-review template to completion and renders a clean HTML report', async () => {
    const { manager, workflowStore } = await importE2eModules()
    const template = getResearchWorkflowTemplate('literature-review')!

    // Template instantiation: exact template nodes/edges become a workflow.
    const workflow = workflowStore.createWorkflow({
      name: 'e2e literature review',
      profile: template.profile,
      nodes: template.nodes,
      edges: template.edges,
    })

    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)

    // The whole pipeline (5 mocked agent nodes + 1 real script subprocess) completed.
    expect(result.run.status).toBe('completed')
    expect(result.run.error).toBeNull()
    for (const nodeId of template.nodes.map(node => node.id)) {
      expect(nodeRow(result, nodeId).status, nodeId).toBe('completed')
    }

    // Agent nodes ran through the mocked chat layer with real sessions.
    expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(5)
    expect(sessionStoreMock.createSession).toHaveBeenCalledTimes(5)
    const searchCall = chatRunMock.runAndWait.mock.calls[0][0]
    expect(String(searchCall.input)).toContain('[Current task]')
    expect(String(searchCall.input)).toContain('文献检索助手')

    // The bound literature-review-outline skill (loaded above through the
    // research skillpack route) is injected ONLY into the writing node that
    // binds it, as full SKILL.md content through the engine's skill binding.
    const draftCall = chatRunMock.runAndWait.mock.calls
      .map(call => call[0])
      .find(call => String(call.input).includes('综述撰写助手'))
    expect(draftCall, 'literature-review draft agent call').toBeTruthy()
    expect(String(draftCall!.input)).toContain('[Workflow selected skills]')
    expect(String(draftCall!.input)).toContain('[Skill: literature-review-outline]')
    expect(String(draftCall!.input)).toContain('综合矩阵')
    // Unbound agent nodes never carry a skill section.
    expect(String(searchCall.input)).not.toContain('[Workflow selected skills]')

    // The HTML report script node really executed and parsed the wrapped
    // upstream draft: no engine wrapper line may leak into the document.
    const report = parseNodeOutput(nodeRow(result, 'lr-html-report'))
    expect(report.format).toBe('html')
    expect(report.title).toBe('图学习文献综述（引用核查版）')
    const document = String(report.document)
    expect(document).toContain('<h1>图学习文献综述（引用核查版）</h1>')
    expect(document).toContain('<li>修正文献 [2] 的发表年份。</li>')
    expect(document).not.toContain('[Workflow upstream results]')
    expect(document).not.toContain('[Upstream:')
    expect(document).not.toContain('[Current task]')
    expect(document).not.toContain('Execute the current workflow node.')
  }, 60000)

  it('runs the paper-translate template to completion through the real deterministic executor', async () => {
    const { manager, workflowStore } = await importE2eModules()
    const template = getResearchWorkflowTemplate('paper-translate')!

    // Fixture: a minimal but valid PDF for the intake node to validate.
    const ptRunDir = join(e2eTestRoot, 'pt-run')
    mkdirSync(ptRunDir, { recursive: true })
    const pdfPath = join(ptRunDir, 'demo-paper.pdf')
    writeFileSync(pdfPath, '%PDF-1.4\n% minimal fixture PDF for the template e2e run\n', 'utf8')

    // Stub the external pdf2zh binary at the subprocess boundary: the
    // translate node spawns this Node wrapper script with pdf2zh's argv
    // contract through PAPER_TRANSLATE_PDF2ZH_BIN. The OPENAI_API_KEY gate is
    // satisfied with a fake key — no real translation endpoint is contacted.
    // AUTH_TOKEN gives the bilingual node the server credential it embeds in
    // the run-files proxy URLs (the script subprocess inherits the server
    // environment, exactly like in production).
    const stubDir = join(e2eTestRoot, 'pdf2zh-stub')
    mkdirSync(stubDir, { recursive: true })
    const pdf2zhStubPath = join(stubDir, 'pdf2zh-stub.js')
    writeFileSync(pdf2zhStubPath, PDF2ZH_STUB_CODE, 'utf8')
    process.env.OPENAI_API_KEY = 'test-only-openai-key'
    process.env.PAPER_TRANSLATE_PDF2ZH_BIN = pdf2zhStubPath
    process.env.AUTH_TOKEN = 'e2e-run-file-proxy-token'

    // Template instantiation; the entry node's authored input is the PDF path,
    // exactly like a user filling in the workflow before pressing run.
    const nodes = template.nodes.map(node => node.id === 'pt-pdf-intake'
      ? { ...node, data: { ...node.data, input: pdfPath } }
      : node)
    const workflow = workflowStore.createWorkflow({
      name: 'e2e paper translate',
      profile: template.profile,
      nodes,
      edges: template.edges,
    })

    const instance = new manager.WorkflowManager()
    const result = await instance.runNow(workflow.id)

    expect(result.run.status).toBe('completed')
    expect(result.run.error).toBeNull()
    for (const nodeId of template.nodes.map(node => node.id)) {
      expect(nodeRow(result, nodeId).status, nodeId).toBe('completed')
    }

    // Script nodes never create chat sessions; only pt-glossary is an agent.
    expect(chatRunMock.runAndWait).toHaveBeenCalledTimes(1)
    expect(sessionStoreMock.createSession).toHaveBeenCalledTimes(1)
    const glossaryCall = chatRunMock.runAndWait.mock.calls[0][0]
    expect(String(glossaryCall.input)).toContain('[Upstream: 双语对照]')
    expect(String(glossaryCall.input)).toContain('bilingualHtmlPath')
    const glossaryRow = nodeRow(result, 'pt-glossary')
    expect(glossaryRow.session_id).not.toBe('')

    // Intake validated the fixture PDF through a real subprocess.
    const intake = parseNodeOutput(nodeRow(result, 'pt-pdf-intake'))
    expect(intake).toMatchObject({ pdfPath, fileName: 'demo-paper.pdf' })
    expect(Number(intake.bytes)).toBeGreaterThan(0)

    // Translate really spawned the stubbed external command (argv contract)
    // and reported the mono/dual artifacts the stub produced.
    const translate = parseNodeOutput(nodeRow(result, 'pt-translate'))
    expect(translate.service).toBe('openai')
    expect(existsSync(String(translate.monoPath))).toBe(true)
    expect(existsSync(String(translate.dualPath))).toBe(true)
    expect(String(translate.monoPath)).toContain(join('paper-translate-out', 'demo-paper-mono.pdf'))

    // Bilingual node consumed translate's JSON and wrote the comparison page.
    const bilingual = parseNodeOutput(nodeRow(result, 'pt-bilingual'))
    const bilingualHtmlPath = String(bilingual.bilingualHtmlPath)
    expect(existsSync(bilingualHtmlPath)).toBe(true)
    expect(bilingual.embed).toBe('server-proxy')
    const bilingualHtml = readFileSync(bilingualHtmlPath, 'utf8')
    expect(bilingualHtml).toContain('demo-paper.pdf 双语对照')

    // The page must NOT embed file:/// URIs (blocked on http origins); every
    // pane streams through the run-files proxy endpoint instead, with the
    // path query parameter carrying the exact generation-time file path.
    expect(bilingualHtml).not.toContain('file:///')
    expect(bilingualHtml).toContain('/api/studio/research/run-files?path=')
    const embeddedTargets = decodeRunFileProxyTargets(bilingualHtml)
    expect(embeddedTargets).toContain(String(translate.monoPath))
    expect(embeddedTargets).toContain(pdfPath)
    // The embed URLs authenticate with the same ?token= pattern as the
    // repository's download routes, using the server-provided credential.
    expect(bilingualHtml).toContain(encodeURIComponent('e2e-run-file-proxy-token'))
    // The dual PDF stays reachable: server URL link plus the local path text.
    expect(bilingualHtml).toContain(String(translate.dualPath))
    expect(embeddedTargets).toContain(String(translate.dualPath))
  }, 60000)
})

/** Extracts and URL-decodes every `path` parameter of proxy embed URLs. */
function decodeRunFileProxyTargets(html: string): string[] {
  const targets: string[] = []
  const pattern = /\/api\/studio\/research\/run-files\?path=([^&"']+)/g
  for (const match of html.matchAll(pattern)) {
    targets.push(decodeURIComponent(match[1]))
  }
  return targets
}
