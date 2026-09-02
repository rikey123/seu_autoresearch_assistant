// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const knowledgeApi = vi.hoisted(() => ({
  listCollections: vi.fn(),
}))

vi.mock('@/api/studio/research-knowledge', () => ({
  listCollections: knowledgeApi.listCollections,
}))

import { useChatKnowledgeStore } from '@/stores/research/chat-knowledge'

const SELECTION_KEY = 'research_kb_selection_v1'

function collection(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    index_status: 'indexed',
    chunks: 3,
    engine: 'paper-qa',
    indexed_at: 1,
    created_at: 1,
    updated_at: 1,
    paper_count: 2,
  }
}

describe('chat knowledge store selection persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  it('persists a new selection to localStorage', async () => {
    const store = useChatKnowledgeStore()
    store.selectForSession('session-1', 'col-1')

    expect(store.selectionBySession['session-1']).toBe('col-1')
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')).toEqual({ 'session-1': 'col-1' })

    store.selectForSession('session-1', null)
    expect(store.selectionBySession['session-1']).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')).toEqual({})
  })

  it('restores persisted selections when the store is created', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'session-1': 'col-1' }))
    knowledgeApi.listCollections.mockResolvedValue([collection('col-1', 'Transformers')])

    const store = useChatKnowledgeStore()
    expect(store.selectionBySession['session-1']).toBe('col-1')
    // Before the collection list loads the selection cannot resolve to a
    // collection object; validation restores the full object.
    expect(store.selectionFor('session-1')).toBeNull()

    await store.ensureSelectionValidated('session-1')

    expect(store.selectionFor('session-1')).toMatchObject({ id: 'col-1', name: 'Transformers' })
    expect(store.invalidatedSelection).toBeNull()
  })

  it('clears a restored selection whose collection no longer exists and surfaces the invalidation', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'session-1': 'col-ghost', 'session-2': 'col-1' }))
    knowledgeApi.listCollections.mockResolvedValue([collection('col-1', 'Transformers')])

    const store = useChatKnowledgeStore()
    const resolved = await store.ensureSelectionValidated('session-1')

    expect(resolved).toBeNull()
    expect(store.selectionBySession['session-1']).toBeUndefined()
    expect(store.selectionBySession['session-2']).toBe('col-1')
    expect(store.invalidatedSelection).toEqual({ sessionId: 'session-1', collectionId: 'col-ghost' })
    // The cleanup is persisted, not just in-memory.
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')).toEqual({ 'session-2': 'col-1' })
  })

  it('dismisses the invalidation notice when another selection is chosen', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'session-1': 'col-ghost' }))
    knowledgeApi.listCollections.mockResolvedValue([collection('col-1', 'Transformers')])

    const store = useChatKnowledgeStore()
    await store.ensureSelectionValidated('session-1')
    expect(store.invalidatedSelection).toEqual({ sessionId: 'session-1', collectionId: 'col-ghost' })

    store.selectForSession('session-1', 'col-1')
    expect(store.invalidatedSelection).toBeNull()
  })

  it('validation without a persisted selection is a no-op', async () => {
    knowledgeApi.listCollections.mockResolvedValue([collection('col-1', 'Transformers')])
    const store = useChatKnowledgeStore()

    expect(await store.ensureSelectionValidated(null)).toBeNull()
    expect(await store.ensureSelectionValidated('session-1')).toBeNull()
    expect(store.invalidatedSelection).toBeNull()
  })

  it('tolerates corrupted persisted selections', () => {
    localStorage.setItem(SELECTION_KEY, '{not json')
    const corrupted = useChatKnowledgeStore()
    expect(corrupted.selectionBySession).toEqual({})

    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'session-1': ['not', 'a', 'string'], 'session-2': 'col-1' }))
    setActivePinia(createPinia())
    const sanitized = useChatKnowledgeStore()
    expect(sanitized.selectionBySession).toEqual({ 'session-2': 'col-1' })
  })

  it('only fetches the collection list once across validations', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({ 'session-1': 'col-1' }))
    knowledgeApi.listCollections.mockResolvedValue([collection('col-1', 'Transformers')])

    const store = useChatKnowledgeStore()
    await store.ensureSelectionValidated('session-1')
    await store.ensureSelectionValidated('session-1')
    await store.ensureCollections()

    expect(knowledgeApi.listCollections).toHaveBeenCalledTimes(1)
  })
})
