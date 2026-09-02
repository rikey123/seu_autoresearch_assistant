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
  WORKFLOW_DETERMINISTIC_NODE_TYPES,
  WORKFLOW_DETERMINISTIC_PRESERVED_DATA_KEYS,
  WORKFLOW_NODE_RUNTIME_DATA_KEYS,
  WORKFLOW_NODE_UI_ONLY_DATA_KEYS,
  WORKFLOW_SCRIPT_NODE_RUNTIME,
  canonicalizeScriptWorkflowNodeData,
  createDeterministicWorkflowNodeData,
  isDeterministicWorkflowNodeType,
  normalizeDeterministicWorkflowNodeData,
  normalizeWorkflowNodeFrame,
  normalizeWorkflowNodeType,
  serializeDeterministicWorkflowNode,
  stripWorkflowUnknownNodeDataFields,
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
      if (WORKFLOW_DETERMINISTIC_PRESERVED_DATA_KEYS.includes(agentKey)) continue
      expect(data, agentKey).not.toHaveProperty(agentKey)
    }
    expect(data).not.toHaveProperty('statusError')
    expect(data).not.toHaveProperty('readonly')
  })

  it('keeps the script contract keys input and orchestration while stripping other agent fields', () => {
    const stored = {
      title: 'Parse PDF',
      input: 'raw payload',
      orchestration: { join: 'any' },
      agent: 'hermes',
      skills: ['pdf-read'],
      onUpdate: () => {},
      status: 'failed',
      readonly: true,
    }
    const data = normalizeDeterministicWorkflowNodeData(stored, 'Parse PDF')
    expect(data).toEqual({
      title: 'Parse PDF',
      input: 'raw payload',
      orchestration: { join: 'any' },
      status: 'idle',
    })
    expect(data).not.toHaveProperty('agent')
    expect(data).not.toHaveProperty('skills')
    expect(data).not.toHaveProperty('onUpdate')
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
  it('keeps script contract fields for script nodes while stripping agent session fields', () => {
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
      data: { title: 'Run checks', command: 'pytest -q', input: 'do things', orchestration: { join: 'any' } },
    })
    const data = serialized.data as Record<string, unknown>
    for (const agentKey of WORKFLOW_AGENT_NODE_DATA_KEYS) {
      if (WORKFLOW_DETERMINISTIC_PRESERVED_DATA_KEYS.includes(agentKey)) continue
      expect(data, agentKey).not.toHaveProperty(agentKey)
    }
    for (const runtimeKey of WORKFLOW_NODE_RUNTIME_DATA_KEYS) {
      expect(data, runtimeKey).not.toHaveProperty(runtimeKey)
    }
    expect(data).not.toHaveProperty('agent')
    expect(data).not.toHaveProperty('onUpdate')
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
    const canvasData = normalizeDeterministicWorkflowNodeData(record.data, record.data.title, type)
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

  it('keeps every unknown-type data field through load → save → load, including agent-conflicting keys', () => {
    // Future node types may legitimately carry keys that collide with the
    // agent vocabulary. None of them may be dropped on a round-trip.
    const storedData: Record<string, unknown> = {
      title: 'Deep dig',
      agent: 'future-runtime',
      model: 'future-model',
      provider: 'future-provider',
      skills: ['web-search'],
      images: ['chart.png'],
      approvalRequired: true,
      agentMode: 'scoped',
      depth: 3,
      tags: ['a', 'b'],
      payload: { nested: { deep: [1, 2, { x: null }] } },
    }
    // load
    const loaded = normalizeDeterministicWorkflowNodeData(storedData, storedData.title as string, 'research')
    expect(loaded).toEqual(storedData)
    // save (canvas data carries UI callbacks that must not be persisted)
    const serialized = serializeDeterministicWorkflowNode({
      id: 'node-9',
      type: 'research',
      position: { x: 1, y: 2 },
      dragHandle: '.node-header',
      style: { width: '300px', height: '550px' },
      data: { ...loaded, onUpdate: () => {}, onUploadImages: async () => [], status: 'failed', statusError: 'boom', readonly: false },
    })
    // load again and compare field by field with the original stored data
    const reloaded = normalizeDeterministicWorkflowNodeData(serialized.data as Record<string, unknown>, storedData.title as string, 'research')
    for (const [key, value] of Object.entries(storedData)) {
      expect(reloaded, key).toHaveProperty(key)
      expect(reloaded[key], key).toEqual(value)
    }
    expect(Object.keys(reloaded).sort()).toEqual(Object.keys(storedData).sort())
  })

  it('strips only proven canvas UI plumbing keys from unknown-type data', () => {
    expect(WORKFLOW_NODE_UI_ONLY_DATA_KEYS).toEqual(['status', 'statusError', 'readonly', 'scriptRuntimeInvalid', 'onUpdate', 'onUploadImages'])
    const stripped = stripWorkflowUnknownNodeDataFields({
      title: 'Keep me',
      status: 'failed',
      statusError: 'transient',
      readonly: true,
      scriptRuntimeInvalid: true,
      onUpdate: () => {},
      onUploadImages: async () => [],
      agent: 'future-runtime',
      model: 'future-model',
    })
    expect(stripped).toEqual({ title: 'Keep me', agent: 'future-runtime', model: 'future-model' })
  })
})

describe('workflow deterministic node creation factories', () => {
  it('creates the minimal server contract payload for each deterministic node type', () => {
    expect(createDeterministicWorkflowNodeData('script', 'Run checks')).toEqual({
      title: 'Run checks',
      input: '',
      orchestration: { join: 'all' },
      runtime: 'node',
      code: '',
    })
    expect(createDeterministicWorkflowNodeData('validate', 'Check results')).toEqual({ title: 'Check results' })
    expect(createDeterministicWorkflowNodeData('render', 'Render report')).toEqual({ title: 'Render report' })
  })

  it('covers exactly the deterministic node types the server dispatches', () => {
    expect([...WORKFLOW_DETERMINISTIC_NODE_TYPES]).toEqual(['script', 'validate', 'render'])
    expect(isDeterministicWorkflowNodeType('script')).toBe(true)
    expect(isDeterministicWorkflowNodeType('validate')).toBe(true)
    expect(isDeterministicWorkflowNodeType('render')).toBe(true)
    expect(isDeterministicWorkflowNodeType('agent')).toBe(false)
    expect(isDeterministicWorkflowNodeType('research')).toBe(false)
    expect(isDeterministicWorkflowNodeType(42)).toBe(false)
  })

  it('round-trips a stored script node through normalize and serialize without loss', () => {
    const stored = {
      id: 'script-2',
      type: 'script',
      position: { x: 10, y: 20 },
      dragHandle: '.node-header',
      style: { width: '300px', height: '550px' },
      data: {
        title: 'Run checks',
        input: 'raw payload',
        orchestration: { join: 'any' },
        runtime: 'node',
        code: 'console.log(input)',
      },
    }
    const loaded = normalizeDeterministicWorkflowNodeData(stored.data, 'Run checks')
    const serialized = serializeDeterministicWorkflowNode({
      id: stored.id,
      type: 'script',
      position: stored.position,
      dragHandle: stored.dragHandle,
      style: stored.style,
      data: loaded,
    })
    expect(serialized.id).toBe('script-2')
    expect(serialized.type).toBe('script')
    expect(serialized.position).toEqual(stored.position)
    expect(serialized.data).toEqual(stored.data)
  })

  it('keeps a freshly created script payload intact when the card callback is attached', () => {
    const created = createDeterministicWorkflowNodeData('script', 'Node 3')
    const loaded = normalizeDeterministicWorkflowNodeData(created, 'Node 3', 'script')
    const serialized = serializeDeterministicWorkflowNode({
      id: 'script-3',
      type: 'script',
      position: { x: 0, y: 0 },
      dragHandle: '.node-header',
      style: {},
      data: { ...loaded, onUpdate: () => {} } as Record<string, unknown>,
    })
    expect(serialized.data).toEqual(created)
  })
})

describe('workflow script runtime canonicalization', () => {
  it('flags invalid or missing runtime without rewriting the stored data', () => {
    const invalid = canonicalizeScriptWorkflowNodeData(
      { title: 'Run checks', runtime: 'python', code: 'print(1)', input: 'x', orchestration: { join: 'all' } },
      'Run checks',
    )
    expect(invalid.scriptRuntimeInvalid).toBe(true)
    expect(invalid.runtime).toBe('python')
    expect(invalid.code).toBe('print(1)')

    const missing = canonicalizeScriptWorkflowNodeData({ title: 'Run checks', code: 'print(1)' }, 'Run checks')
    expect(missing.scriptRuntimeInvalid).toBe(true)
    expect(missing).not.toHaveProperty('runtime')

    expect(WORKFLOW_SCRIPT_NODE_RUNTIME).toBe('node')
  })

  it('keeps valid script data canonicalization-transparent and clears the invalid flag', () => {
    const valid = canonicalizeScriptWorkflowNodeData(
      { title: 'Run checks', runtime: 'node', code: 'console.log(input)', input: '', orchestration: { join: 'all' } },
      'Run checks',
    )
    expect(valid.scriptRuntimeInvalid).toBe(false)
    expect(valid).toEqual({
      title: 'Run checks',
      runtime: 'node',
      code: 'console.log(input)',
      input: '',
      orchestration: { join: 'all' },
      status: 'idle',
      scriptRuntimeInvalid: false,
    })
  })

  it('never persists the client-only invalid flag or runtime keys when saving an invalid script node', () => {
    const canvasData = canonicalizeScriptWorkflowNodeData({ title: 'Run checks', runtime: 'python', code: 'print(1)' }, 'Run checks')
    expect(canvasData.scriptRuntimeInvalid).toBe(true)
    const serialized = serializeDeterministicWorkflowNode({
      id: 'script-2',
      type: 'script',
      position: { x: 0, y: 0 },
      dragHandle: '.node-header',
      style: {},
      data: { ...canvasData, onUpdate: () => {} } as Record<string, unknown>,
    })
    const data = serialized.data as Record<string, unknown>
    expect(data.runtime).toBe('python')
    expect(data.code).toBe('print(1)')
    for (const runtimeKey of WORKFLOW_NODE_RUNTIME_DATA_KEYS) {
      expect(data, runtimeKey).not.toHaveProperty(runtimeKey)
    }
  })
})

describe('workflow canvas type guard wiring', () => {
  it('loads stored nodes through the type-aware normalizer and keeps agent loading intact', () => {
    expect(view).toContain('const type = normalizeWorkflowNodeType(record.type)')
    expect(view).toContain("if (type !== 'agent') {")
    expect(view).toContain('canonicalizeScriptWorkflowNodeData(data, title)')
    expect(view).toContain('normalizeDeterministicWorkflowNodeData(data, title, type)')
    expect(view).toContain('normalizeWorkflowNodeFrame(record, index)')
    expect(view).toContain("reasoningEffort: typeof data.reasoningEffort === 'string'")
    expect(view).toContain("reasoningEffort: data.reasoningEffort || 'default'")
  })

  it('blocks saving when a script node violates the deterministic runtime contract', () => {
    const validationBody = view.slice(
      view.indexOf('function workflowValidationError()'),
      view.indexOf('async function saveActiveWorkflow'),
    )
    expect(validationBody).toContain('scriptRuntimeInvalid')
    expect(validationBody).toContain("t('workflow.validation.scriptRuntimeInvalid', { node: label })")
    expect(validationBody).toContain('workflow.validation.scriptCodeRequired')
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

  it('registers canvas templates for script, validate, and render node types', () => {
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

  it('makes deterministic cards editable in authoring and inert in readonly replay', () => {
    expect(card).toContain('onUpdate')
    expect(card).toContain('<NInput')
    expect(card).not.toContain('<NSelect')
    expect(card).not.toContain('<NSwitch')
    expect(card).toContain('node-code-input')
    expect(card).toContain('workflow.deterministic.code')
    expect(card).toContain('workflow.deterministic.codePlaceholder')
    expect(card).toContain('workflow.deterministic.inputPlaceholder')
    expect(card).toContain('workflow.deterministic.configPending')
    expect(card).toContain('const isReadonly = computed(() => props.data.readonly === true)')
    expect(card.match(/:disabled="isReadonly"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(card).toContain('nodrag nopan')
    expect(card).toContain('Handle id="input"')
    expect(card).toContain('Handle id="output"')
  })

  it('still creates agent nodes by default on the canvas', () => {
    const makeNodeBody = view.slice(view.indexOf('function makeNode('), view.indexOf('function makeInitialNodes'))
    expect(makeNodeBody).toContain("type: 'agent'")
  })

  it('creates deterministic nodes from the toolbar and from connection drops off deterministic nodes', () => {
    expect(view).toContain('function makeDeterministicNode(')
    expect(view).toContain('createDeterministicWorkflowNodeData(type, title)')
    expect(view).toContain('function updateDeterministicNodeData(')
    expect(view).toContain('async function addDeterministicNode(')
    expect(view).toContain('createConnectedDeterministicNodeTransaction<WorkflowNode, WorkflowEdge>(')
    expect(view).toContain('const nodeId = `${type}-${nextNodeIndex.value}`')
    expect(view).toContain('/^(?:agent|script|validate|render)-(\\d+)$/')
    expect(view).toContain('if (sourceNode && !isWorkflowAgentNode(sourceNode)) {')
    expect(view).toContain('normalizeDeterministicWorkflowNodeData(data, title, type)')
  })

  it('surfaces the failed statusError tooltip on deterministic cards like agent cards', () => {
    expect(card).toContain('const statusTip = computed(() => (')
    expect(card).toContain("props.data.status === 'failed' && props.data.statusError?.trim()")
    expect(card).toContain('<NTooltip v-if="statusTip" trigger="hover" placement="top">')
    expect(card).toContain('<span class="node-status-tip">{{ statusTip }}</span>')
    expect(card).toContain('.node-status-tip {')
  })

  it('defines the deterministic script validation copy in every locale', () => {
    const expected = {
      en: {
        scriptRuntimeInvalid: 'Node {node} has an unsupported script runtime. Only "node" is supported.',
        scriptCodeRequired: 'Node {node} needs script code before saving',
      },
      zh: {
        scriptRuntimeInvalid: '节点 {node} 的脚本运行时不受支持，仅支持 "node"。',
        scriptCodeRequired: '节点 {node} 需要填写脚本代码后才能保存',
      },
      'zh-TW': {
        scriptRuntimeInvalid: '節點 {node} 的腳本執行環境不受支援，僅支援 "node"。',
        scriptCodeRequired: '節點 {node} 需要填寫腳本程式碼後才能儲存',
      },
      ja: {
        scriptRuntimeInvalid: 'ノード {node} のスクリプトランタイムはサポートされていません。「node」のみサポートされています。',
        scriptCodeRequired: 'ノード {node} は保存前にスクリプトコードが必要です',
      },
      ko: {
        scriptRuntimeInvalid: '노드 {node}의 스크립트 런타임이 지원되지 않습니다. "node"만 지원됩니다.',
        scriptCodeRequired: '노드 {node}은(는) 저장하기 전에 스크립트 코드가 필요합니다',
      },
      fr: {
        scriptRuntimeInvalid: 'Le nœud {node} utilise un runtime de script non pris en charge. Seul « node » est pris en charge.',
        scriptCodeRequired: 'Le nœud {node} doit contenir le code du script avant l’enregistrement',
      },
      es: {
        scriptRuntimeInvalid: 'El nodo {node} usa un entorno de ejecución de script no compatible. Solo se admite "node".',
        scriptCodeRequired: 'El nodo {node} necesita código de script antes de guardar',
      },
      de: {
        scriptRuntimeInvalid: 'Knoten {node} verwendet eine nicht unterstützte Skript-Laufzeit. Nur „node“ wird unterstützt.',
        scriptCodeRequired: 'Knoten {node} benötigt vor dem Speichern Skript-Code',
      },
      pt: {
        scriptRuntimeInvalid: 'O nó {node} usa um runtime de script não compatível. Apenas "node" é compatível.',
        scriptCodeRequired: 'O nó {node} precisa do código do script antes de salvar',
      },
      ru: {
        scriptRuntimeInvalid: 'Узел {node}: неподдерживаемая среда выполнения скрипта. Поддерживается только «node».',
        scriptCodeRequired: 'Узел {node}: перед сохранением нужно указать код скрипта',
      },
      ar: {
        scriptRuntimeInvalid: 'العقدة {node} تستخدم بيئة تشغيل غير مدعومة للسكربت. البيئة المدعومة هي "node" فقط.',
        scriptCodeRequired: 'العقدة {node} تحتاج إلى شيفرة السكربت قبل الحفظ',
      },
    }
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const expectedForLocale = expected[locale as keyof typeof expected]
      expect(messages.workflow.validation.scriptRuntimeInvalid, `${locale}.workflow.validation.scriptRuntimeInvalid`).toBe(expectedForLocale.scriptRuntimeInvalid)
      expect(messages.workflow.validation.scriptCodeRequired, `${locale}.workflow.validation.scriptCodeRequired`).toBe(expectedForLocale.scriptCodeRequired)
    }
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

  it('defines deterministic creation and card copy in every locale', () => {
    const expected = {
      en: {
        addNodeResearch: 'Add research node',
        code: 'Code',
        codePlaceholder: 'JavaScript code executed by Node.js when this node runs',
        inputPlaceholder: 'Optional input passed to the script (can stay empty)',
        configPending: 'Configuration for this node type will be available in a future version.',
      },
      zh: {
        addNodeResearch: '添加科研节点',
        code: '代码',
        codePlaceholder: '本节点执行时由 Node.js 运行的 JavaScript 代码',
        inputPlaceholder: '传给脚本的可选输入（可留空）',
        configPending: '该节点类型的配置将在后续版本提供。',
      },
      'zh-TW': {
        addNodeResearch: '新增科研節點',
        code: '程式碼',
        codePlaceholder: '本節點執行時由 Node.js 執行的 JavaScript 程式碼',
        inputPlaceholder: '傳給腳本的選用輸入（可留空）',
        configPending: '此節點類型的設定將於後續版本提供。',
      },
      ja: {
        addNodeResearch: 'リサーチノードを追加',
        code: 'コード',
        codePlaceholder: 'このノードの実行時に Node.js が実行する JavaScript コード',
        inputPlaceholder: 'スクリプトに渡す任意の入力（省略可）',
        configPending: 'このノードタイプの設定は今後のバージョンで提供予定です。',
      },
      ko: {
        addNodeResearch: '리서치 노드 추가',
        code: '코드',
        codePlaceholder: '이 노드가 실행될 때 Node.js에서 실행되는 JavaScript 코드',
        inputPlaceholder: '스크립트에 전달할 선택적 입력(비워 두어도 됨)',
        configPending: '이 노드 유형의 설정은 이후 버전에서 제공될 예정입니다.',
      },
      fr: {
        addNodeResearch: 'Ajouter un nœud de recherche',
        code: 'Code',
        codePlaceholder: 'Code JavaScript exécuté par Node.js lorsque ce nœud s’exécute',
        inputPlaceholder: 'Entrée facultative transmise au script (peut rester vide)',
        configPending: 'La configuration de ce type de nœud sera disponible dans une version ultérieure.',
      },
      es: {
        addNodeResearch: 'Añadir nodo de investigación',
        code: 'Código',
        codePlaceholder: 'Código JavaScript que Node.js ejecuta cuando se ejecuta este nodo',
        inputPlaceholder: 'Entrada opcional que se pasa al script (puede dejarse vacía)',
        configPending: 'La configuración de este tipo de nodo estará disponible en una versión posterior.',
      },
      de: {
        addNodeResearch: 'Forschungsknoten hinzufügen',
        code: 'Code',
        codePlaceholder: 'JavaScript-Code, den Node.js beim Ausführen dieses Knotens ausführt',
        inputPlaceholder: 'Optionale Eingabe, die an das Skript übergeben wird (kann leer bleiben)',
        configPending: 'Die Konfiguration dieses Knotentyps wird in einer späteren Version verfügbar sein.',
      },
      pt: {
        addNodeResearch: 'Adicionar nó de pesquisa',
        code: 'Código',
        codePlaceholder: 'Código JavaScript executado pelo Node.js quando este nó é executado',
        inputPlaceholder: 'Entrada opcional passada para o script (pode ficar vazia)',
        configPending: 'A configuração deste tipo de nó estará disponível em uma versão futura.',
      },
      ru: {
        addNodeResearch: 'Добавить исследовательский узел',
        code: 'Код',
        codePlaceholder: 'Код JavaScript, выполняемый Node.js при запуске этого узла',
        inputPlaceholder: 'Необязательные входные данные, передаваемые скрипту (можно оставить пустым)',
        configPending: 'Настройка этого типа узла появится в следующей версии.',
      },
      ar: {
        addNodeResearch: 'إضافة عقدة بحث',
        code: 'الشيفرة',
        codePlaceholder: 'شيفرة JavaScript ينفذها Node.js عند تشغيل هذه العقدة',
        inputPlaceholder: 'مدخل اختياري يُمرَّر إلى السكربت (يمكن تركه فارغًا)',
        configPending: 'سيتم توفير إعدادات هذا النوع من العقد في إصدار لاحق.',
      },
    }
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const expectedForLocale = expected[locale as keyof typeof expected]
      expect(messages.workflow.actions.addNodeResearch, `${locale}.workflow.actions.addNodeResearch`).toBe(expectedForLocale.addNodeResearch)
      expect(messages.workflow.deterministic, `${locale}.workflow.deterministic`).toEqual({
        code: expectedForLocale.code,
        codePlaceholder: expectedForLocale.codePlaceholder,
        inputPlaceholder: expectedForLocale.inputPlaceholder,
        configPending: expectedForLocale.configPending,
      })
    }
  })
})
