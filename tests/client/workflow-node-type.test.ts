import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '../../packages/client/src/i18n/locales/en'
import zh from '../../packages/client/src/i18n/locales/zh'
import zhTW from '../../packages/client/src/i18n/locales/zh-TW'
import ru from '../../packages/client/src/i18n/locales/ru'
import ja from '../../packages/client/src/i18n/locales/ja'
import ko from '../../packages/client/src/i18n/locales/ko'
import fr from '../../packages/client/src/i18n/locales/fr'
import es from '../../packages/client/src/i18n/locales/es'
import de from '../../packages/client/src/i18n/locales/de'
import pt from '../../packages/client/src/i18n/locales/pt'
import ar from '../../packages/client/src/i18n/locales/ar'
import {
  WORKFLOW_AGENT_NODE_DATA_KEYS,
  WORKFLOW_NODE_RUNTIME_DATA_KEYS,
  normalizeDeterministicWorkflowNodeData,
  normalizeWorkflowNodeFrame,
  normalizeWorkflowNodeType,
  serializeDeterministicWorkflowNode,
} from '../../packages/client/src/utils/workflow-node-type'

const read = (path: string) => readFileSync(path, 'utf8')
const view = read('packages/client/src/views/hermes/WorkflowView.vue')
const card = read('packages/client/src/components/hermes/workflow/WorkflowDeterministicNode.vue')

const localeMessages: Record<string, Record<string, any>> = {
  en, zh, 'zh-TW': zhTW, ru, ja, ko, fr, es, de, pt, ar,
}

describe('workflow node type normalization', () => {
  it('passes stored node types through and falls back to agent only when absent or invalid', () => {
    expect(normalizeWorkflowNodeType('agent')).toBe('agent')
    expect(normalizeWorkflowNodeType('script')).toBe('script')
    expect(normalizeWorkflowNodeType('validate')).toBe('validate')
    expect(normalizeWorkflowNodeType('render')).toBe('render')
    expect(normalizeWorkflowNodeType('research')).toBe('research')
    expect(normalizeWorkflowNodeType(undefined)).toBe('agent')
    expect(normalizeWorkflowNodeType(null)).toBe('agent')
    expect(normalizeWorkflowNodeType('')).toBe('agent')
    expect(normalizeWorkflowNodeType(42)).toBe('agent')
    expect(normalizeWorkflowNodeType({ type: 'script' })).toBe('agent')
  })

  it('normalizes deterministic node data without injecting agent fields', () => {
    const stored = {
      title: 'Parse PDF',
      command: 'python parse.py',
      input: 'legacy prompt leak',
      agent: 'hermes',
      agentMode: 'scoped',
      skills: ['pdf-read'],
      status: 'failed',
      statusError: 'boom',
      readonly: true,
    }
    const data = normalizeDeterministicWorkflowNodeData(stored, 'Parse PDF')
    expect(data).toEqual({ title: 'Parse PDF', command: 'python parse.py', status: 'idle' })
    for (const agentKey of WORKFLOW_AGENT_NODE_DATA_KEYS) {
      expect(data, agentKey).not.toHaveProperty(agentKey)
    }
    expect(data).not.toHaveProperty('statusError')
    expect(data).not.toHaveProperty('readonly')
  })

  it('falls back to the caller title and resets status for deterministic nodes', () => {
    const data = normalizeDeterministicWorkflowNodeData(undefined, 'Node 2')
    expect(data).toEqual({ title: 'Node 2', status: 'idle' })
  })

  it('normalizes stored frames exactly like the baseline node loader', () => {
    expect(normalizeWorkflowNodeFrame({ position: { x: 15, y: 25 }, dragHandle: '.custom', style: { width: '320px' } }, 0)).toEqual({
      position: { x: 15, y: 25 },
      dragHandle: '.custom',
      storedWidth: '320px',
      storedHeight: null,
    })
    expect(normalizeWorkflowNodeFrame({}, 3)).toEqual({
      position: { x: 80 + 3 * 320, y: 120 },
      dragHandle: '.node-header',
      storedWidth: null,
      storedHeight: null,
    })
  })
})

describe('workflow deterministic node serialization', () => {
  it('never writes agent fields for script nodes while keeping node-level fields', () => {
    const onUpdate = () => {}
    const serialized = serializeDeterministicWorkflowNode({
      id: 'agent-2',
      type: 'script',
      position: { x: 10, y: 20 },
      dragHandle: '.node-header',
      style: { width: '300px', height: '550px' },
      data: {
        title: 'Run checks',
        command: 'pytest -q',
        agent: 'claude-code',
        agentMode: 'global',
        provider: 'anthropic',
        model: 'claude-opus-5',
        apiMode: 'anthropic_messages',
        reasoningEffort: 'high',
        input: 'do things',
        skills: ['review'],
        images: ['a.png'],
        approvalRequired: true,
        orchestration: { join: 'any' },
        agentOptions: [],
        skillOptions: [],
        skillsLoading: false,
        modelGroups: [],
        onUpdate,
        onUploadImages: async () => [],
        status: 'completed',
        statusError: null,
        readonly: true,
      } as Record<string, unknown>,
    })
    expect(serialized).toEqual({
      id: 'agent-2',
      type: 'script',
      position: { x: 10, y: 20 },
      dragHandle: '.node-header',
      style: { width: '300px', height: '550px' },
      data: { title: 'Run checks', command: 'pytest -q' },
    })
    const data = serialized.data as Record<string, unknown>
    for (const agentKey of WORKFLOW_AGENT_NODE_DATA_KEYS) {
      expect(data, agentKey).not.toHaveProperty(agentKey)
    }
    for (const runtimeKey of WORKFLOW_NODE_RUNTIME_DATA_KEYS) {
      expect(data, runtimeKey).not.toHaveProperty(runtimeKey)
    }
    expect(serialized).not.toHaveProperty('data.agent')
  })

  it('round-trips unknown-type records through normalize and serialize without loss', () => {
    const record = {
      id: 'node-9',
      type: 'research',
      position: { x: 120, y: 80 },
      dragHandle: '.node-header',
      style: { width: '300px', height: '550px' },
      data: { title: 'Deep dig', depth: 3, tags: ['a', 'b'], payload: { nested: true } },
    }
    const type = normalizeWorkflowNodeType(record.type)
    const frame = normalizeWorkflowNodeFrame(record, 0)
    const canvasData = normalizeDeterministicWorkflowNodeData(record.data, record.data.title)
    const serialized = serializeDeterministicWorkflowNode({
      id: record.id,
      type,
      position: frame.position,
      dragHandle: frame.dragHandle,
      style: { width: frame.storedWidth || '300px', height: frame.storedHeight || '550px' },
      data: canvasData,
    })
    expect(serialized.type).toBe('research')
    expect(serialized.id).toBe('node-9')
    expect(serialized.position).toEqual(record.position)
    expect(serialized.data).toEqual(record.data)
  })
})

describe('workflow canvas type guard wiring', () => {
  it('loads stored nodes through the type-aware normalizer and keeps agent loading intact', () => {
    expect(view).toContain('const type = normalizeWorkflowNodeType(record.type)')
    expect(view).toContain('if (type !== \'agent\') {')
    expect(view).toContain('normalizeDeterministicWorkflowNodeData(data, title)')
    expect(view).toContain('normalizeWorkflowNodeFrame(record, index)')
    expect(view).toContain('reasoningEffort: typeof data.reasoningEffort === \'string\'')
    expect(view).toContain("reasoningEffort: data.reasoningEffort || 'default'")
  })

  it('serializes agent nodes with the untouched baseline shape and deterministic nodes via the guard', () => {
    const serializeBody = view.slice(
      view.indexOf('function serializeWorkflowNodes'),
      view.indexOf('function serializeWorkflowEdges'),
    )
    expect(serializeBody).toContain('serializeDeterministicWorkflowNode')
    for (const field of [
      'title: node.data.title',
      'agent: node.data.agent',
      'agentMode: node.data.agentMode',
      'provider: node.data.provider',
      'model: node.data.model',
      'apiMode: node.data.apiMode',
      'reasoningEffort: node.data.reasoningEffort',
      'input: node.data.input',
      'skills: [...node.data.skills]',
      'images: [...node.data.images]',
      'approvalRequired: node.data.approvalRequired === true',
      'orchestration: { join: node.data.orchestration?.join === \'any\' ? \'any\' : \'all\' }',
    ]) {
      expect(serializeBody, field).toContain(field)
    }
  })

  it('registers read-only canvas templates for script, validate, and render node types', () => {
    for (const nodeType of ['script', 'validate', 'render']) {
      expect(view).toContain(`#node-${nodeType}="nodeProps"`)
    }
    expect(view.match(/<WorkflowDeterministicNode v-bind="nodeProps" \/>/g)?.length).toBe(3)
    expect(card).toContain('workflow.node.readonlyBadge')
    expect(card).toContain('workflow.nodeType.script')
    expect(card).toContain('workflow.nodeType.validate')
    expect(card).toContain('workflow.nodeType.render')
    expect(card).toContain('workflow.nodeType.unknown')
  })

  it('keeps the read-only card free of editing entry points', () => {
    expect(card).not.toContain('onUpdate')
    expect(card).not.toContain('onUploadImages')
    expect(card).not.toContain('NInput')
    expect(card).not.toContain('NSelect')
    expect(card).not.toContain('NSwitch')
    expect(card).toContain('Handle id="input"')
    expect(card).toContain('Handle id="output"')
  })

  it('still creates agent nodes by default on the canvas', () => {
    const makeNodeBody = view.slice(view.indexOf('function makeNode('), view.indexOf('function makeInitialNodes'))
    expect(makeNodeBody).toContain("type: 'agent'")
  })

  it('defines the deterministic node type labels in every locale', () => {
    const expected = {
      en: { readonlyBadge: 'Read-only', script: 'Script', validate: 'Validate', render: 'Render', unknown: 'Unknown type' },
      zh: { readonlyBadge: '只读', script: '脚本', validate: '校验', render: '渲染', unknown: '未知类型' },
      'zh-TW': { readonlyBadge: '唯讀', script: '腳本', validate: '驗證', render: '渲染', unknown: '未知類型' },
      ja: { readonlyBadge: '読み取り専用', script: 'スクリプト', validate: '検証', render: 'レンダリング', unknown: '不明なタイプ' },
      ko: { readonlyBadge: '읽기 전용', script: '스크립트', validate: '검증', render: '렌더링', unknown: '알 수 없는 유형' },
      fr: { readonlyBadge: 'Lecture seule', script: 'Script', validate: 'Validation', render: 'Rendu', unknown: 'Type inconnu' },
      es: { readonlyBadge: 'Solo lectura', script: 'Script', validate: 'Validación', render: 'Renderizado', unknown: 'Tipo desconocido' },
      de: { readonlyBadge: 'Schreibgeschützt', script: 'Skript', validate: 'Validierung', render: 'Rendern', unknown: 'Unbekannter Typ' },
      pt: { readonlyBadge: 'Somente leitura', script: 'Script', validate: 'Validação', render: 'Renderização', unknown: 'Tipo desconhecido' },
      ru: { readonlyBadge: 'Только чтение', script: 'Скрипт', validate: 'Проверка', render: 'Рендеринг', unknown: 'Неизвестный тип' },
      ar: { readonlyBadge: 'للقراءة فقط', script: 'سكربت', validate: 'تحقق', render: 'عرض', unknown: 'نوع غير معروف' },
    }
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const expectedForLocale = expected[locale as keyof typeof expected]
      expect(messages.workflow.node.readonlyBadge, `${locale}.workflow.node.readonlyBadge`).toBe(expectedForLocale.readonlyBadge)
      expect(messages.workflow.nodeType, `${locale}.workflow.nodeType`).toEqual({
        script: expectedForLocale.script,
        validate: expectedForLocale.validate,
        render: expectedForLocale.render,
        unknown: expectedForLocale.unknown,
      })
    }
  })
})
