// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '../../packages/client/src/i18n/locales/en'
import WorkflowDeterministicNode from '../../packages/client/src/components/hermes/workflow/WorkflowDeterministicNode.vue'
import { createConnectedAgentTransaction, createConnectedDeterministicNodeTransaction, undoCanvasTransaction } from '../../packages/client/src/utils/workflow-canvas'

vi.mock('@vue-flow/core', () => ({
  Handle: { template: '<span class="handle-stub" />' },
  Position: { Left: 'left', Top: 'top', Right: 'right', Bottom: 'bottom' },
}))

vi.mock('naive-ui', () => ({
  NInput: {
    props: ['value', 'disabled', 'placeholder', 'type', 'resizable'],
    emits: ['update:value'],
    template: '<input :value="value" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
}))

describe('workflow canvas atomic transactions', () => {
  it('creates one node and one edge without copying source data', () => {
    const before = { nodes: [{ id: 'source', data: { token: 'secret' } }], edges: [] }
    const result = createConnectedAgentTransaction(before as any, { source: 'source', nodeId: 'agent-2', title: 'Agent 2', position: { x: 10, y: 20 }, nodeData: { agent: 'hermes' } })
    expect(result.after.nodes).toHaveLength(2)
    expect(result.after.edges).toEqual([expect.objectContaining({ source: 'source', target: 'agent-2' })])
    expect(result.after.nodes[1].data).toEqual({ agent: 'hermes' })
    expect(undoCanvasTransaction(result)).toEqual(before)
  })
  it('rejects an absent source atomically', () => {
    expect(() => createConnectedAgentTransaction({ nodes: [], edges: [] }, { source: 'missing', nodeId: 'agent-1', title: 'Agent', position: { x: 0, y: 0 }, nodeData: {} })).toThrow('source node does not exist')
  })

  it('keeps the side handle used when a dangling connection creates a node', () => {
    const before = { nodes: [{ id: 'source', data: {} }], edges: [] }
    const result = createConnectedAgentTransaction(before as any, {
      source: 'source', sourceHandle: 'top', nodeId: 'agent-2', title: 'Agent 2',
      position: { x: 10, y: 20 }, nodeData: { agent: 'hermes' },
    })
    expect(result.after.edges).toEqual([expect.objectContaining({ sourceHandle: 'top', targetHandle: 'input' })])
  })
})

describe('workflow canvas deterministic node transactions', () => {
  const scriptNodeData = {
    title: 'Script',
    input: '',
    orchestration: { join: 'all' },
    runtime: 'node',
    code: '',
  }

  it('creates one deterministic node and one edge without copying source data', () => {
    const before = { nodes: [{ id: 'agent-1', data: { token: 'secret' } }], edges: [] }
    const result = createConnectedDeterministicNodeTransaction(before as any, {
      source: 'agent-1', nodeId: 'script-2', nodeType: 'script', position: { x: 10, y: 20 }, nodeData: scriptNodeData,
    })
    expect(result.after.nodes).toHaveLength(2)
    expect(result.after.nodes[1]).toMatchObject({ id: 'script-2', type: 'script', position: { x: 10, y: 20 } })
    expect(result.after.nodes[1].data).toEqual(scriptNodeData)
    expect(result.after.edges).toEqual([expect.objectContaining({ source: 'agent-1', target: 'script-2', sourceHandle: 'output', targetHandle: 'input', type: 'smoothstep' })])
    expect(undoCanvasTransaction(result)).toEqual(before)
  })

  it('rejects an absent source and a duplicate node id atomically', () => {
    expect(() => createConnectedDeterministicNodeTransaction({ nodes: [], edges: [] } as any, {
      source: 'missing', nodeId: 'render-1', nodeType: 'render', position: { x: 0, y: 0 }, nodeData: { title: 'Render' },
    })).toThrow('source node does not exist')
    const state = { nodes: [{ id: 'validate-1', data: {} }], edges: [] }
    expect(() => createConnectedDeterministicNodeTransaction(state as any, {
      source: 'validate-1', nodeId: 'validate-1', nodeType: 'validate', position: { x: 0, y: 0 }, nodeData: { title: 'Validate' },
    })).toThrow('target node already exists')
  })

  it('keeps the dropped source handle when the new node is deterministic', () => {
    const before = { nodes: [{ id: 'script-1', data: {} }], edges: [] }
    const result = createConnectedDeterministicNodeTransaction(before as any, {
      source: 'script-1', sourceHandle: 'bottom', nodeId: 'agent-9', nodeType: 'render', position: { x: 1, y: 2 }, nodeData: { title: 'Render' },
    })
    expect(result.after.edges).toEqual([expect.objectContaining({ sourceHandle: 'bottom', targetHandle: 'input' })])
  })
})

describe('workflow deterministic card real mounting', () => {
  // Real component mount (not source-string inspection): the card renders the
  // unknown-type fallback and becomes inert in readonly replay mode.
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: false, messages: { en } })

  function mountDeterministicCard(props: Record<string, unknown>) {
    return mount(WorkflowDeterministicNode, {
      global: { plugins: [i18n] },
      props,
    })
  }

  it('renders the unknown-type fallback for an unregistered node type', () => {
    const wrapper = mountDeterministicCard({
      id: 'node-9',
      type: 'research',
      data: { title: 'Deep dig', status: 'idle' },
    })
    expect(wrapper.find('.node-type-label').text()).toBe('Unknown type')
    expect(wrapper.find('.node-status-label').text()).toBe('Idle')
    // Unknown types get the config-pending placeholder body, not script fields.
    expect(wrapper.find('.node-config-pending').exists()).toBe(true)
    expect(wrapper.find('.node-code-input').exists()).toBe(false)
    expect(wrapper.find('.node-input-input').exists()).toBe(false)
    // The four connection handles still exist on the unknown card.
    expect(wrapper.findAll('.handle-stub')).toHaveLength(4)
  })

  it('makes a script card editable in authoring mode and forwards field updates', async () => {
    const onUpdate = vi.fn()
    const wrapper = mountDeterministicCard({
      id: 'script-1',
      type: 'script',
      data: { title: 'Script', code: 'console.log(1)', input: 'seed', status: 'idle', onUpdate },
    })
    expect(wrapper.find('.node-type-label').text()).toBe('Script')
    expect(wrapper.findAll('.handle-stub')).toHaveLength(4)
    expect(wrapper.find('.node-readonly-badge').exists()).toBe(false)
    const titleInput = wrapper.find('.node-title-input')
    expect(titleInput.attributes('disabled')).toBeUndefined()
    await titleInput.setValue('Renamed')
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith('script-1', { title: 'Renamed' })
    const codeInput = wrapper.find('.node-code-input')
    expect(codeInput.attributes('disabled')).toBeUndefined()
    await codeInput.setValue('console.log(2)')
    expect(onUpdate).toHaveBeenLastCalledWith('script-1', { code: 'console.log(2)' })
  })

  it('blocks editing in readonly replay mode while keeping the card readable', () => {
    const onUpdate = vi.fn()
    const wrapper = mountDeterministicCard({
      id: 'script-1',
      type: 'script',
      data: { title: 'Script', code: 'console.log(1)', input: 'seed', status: 'completed', readonly: true, onUpdate },
    })
    expect(wrapper.find('.node-readonly-badge').exists()).toBe(true)
    expect(wrapper.find('.node-readonly-badge').text()).toBe('Read-only')
    expect(wrapper.find('.node-status-label').text()).toBe('Completed')
    // Every editable field is disabled in replay; the card exposes no
    // delete/remove affordance either (deletion is a canvas-level action that
    // the snapshot view does not wire for readonly nodes).
    for (const selector of ['.node-title-input', '.node-code-input', '.node-input-input']) {
      expect(wrapper.find(selector).attributes('disabled'), selector).toBeDefined()
    }
    expect((wrapper.find('.node-code-input').element as HTMLInputElement).value).toBe('console.log(1)')
    expect((wrapper.find('.node-title-input').element as HTMLInputElement).value).toBe('Script')
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
