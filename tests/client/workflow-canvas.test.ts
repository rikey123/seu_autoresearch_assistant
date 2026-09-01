import { describe, expect, it } from 'vitest'
import { createConnectedAgentTransaction, createConnectedDeterministicNodeTransaction, undoCanvasTransaction } from '../../packages/client/src/utils/workflow-canvas'

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
