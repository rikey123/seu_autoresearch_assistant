import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as knowledgeApi from '@/api/studio/research-knowledge'
import type { RagCollection } from '@/api/studio/research-knowledge'

/**
 * Client state for @-mentioning a RAG knowledge base in the chat composer.
 * Holds the collection list for the mention popup and the per-session
 * knowledge base selection. The selection is per chat session and persisted
 * to localStorage so it survives a reload; an unanswered selection never
 * changes what a plain chat run sends.
 */

const SELECTION_STORAGE_KEY = 'research_kb_selection_v1'

function loadStoredSelections(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, string> = {}
    for (const [sessionId, collectionId] of Object.entries(parsed as Record<string, unknown>)) {
      if (sessionId && typeof collectionId === 'string' && collectionId) next[sessionId] = collectionId
    }
    return next
  } catch {
    return {}
  }
}

function saveStoredSelections(selections: Record<string, string>): void {
  try {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // ignore quota/storage errors — fall back to in-memory only
  }
}

export const useChatKnowledgeStore = defineStore('research-chat-knowledge', () => {
  const collections = ref<RagCollection[]>([])
  const collectionsLoading = ref(false)
  const collectionsLoaded = ref(false)
  const selectionBySession = ref<Record<string, string>>(loadStoredSelections())
  /** First restored selection dropped by validation, for a composer hint. */
  const invalidatedSelection = ref<{ sessionId: string; collectionId: string } | null>(null)

  function collectionById(id: string): RagCollection | null {
    return collections.value.find(collection => collection.id === id) || null
  }

  const selectableCollections = computed(() =>
    [...collections.value].sort((a, b) => a.name.localeCompare(b.name)),
  )

  /** Load the collection list once; a failed load retries on the next open. */
  async function ensureCollections(): Promise<void> {
    if (collectionsLoading.value) return
    if (collectionsLoaded.value) return
    collectionsLoading.value = true
    try {
      collections.value = await knowledgeApi.listCollections()
      collectionsLoaded.value = true
      // Lazy validation: restored selections whose collection vanished are
      // cleared the first time the collection list is available.
      pruneInvalidSelections()
    } catch {
      collections.value = []
      collectionsLoaded.value = false
    } finally {
      collectionsLoading.value = false
    }
  }

  /**
   * Drop persisted selections whose collection no longer exists. Returns the
   * cleared session ids; the first one is surfaced through invalidatedSelection
   * so the composer can explain why the chip disappeared.
   */
  function pruneInvalidSelections(): string[] {
    if (!collectionsLoaded.value) return []
    const removed: string[] = []
    const next = { ...selectionBySession.value }
    for (const [sessionId, collectionId] of Object.entries(next)) {
      if (collectionById(collectionId)) continue
      delete next[sessionId]
      removed.push(sessionId)
      if (!invalidatedSelection.value) {
        invalidatedSelection.value = { sessionId, collectionId }
      }
    }
    if (removed.length > 0) {
      selectionBySession.value = next
      saveStoredSelections(next)
    }
    return removed
  }

  function selectionFor(sessionId: string | null | undefined): RagCollection | null {
    if (!sessionId) return null
    const id = selectionBySession.value[sessionId]
    return id ? collectionById(id) : null
  }

  function selectForSession(sessionId: string, collectionId: string | null): void {
    const next = { ...selectionBySession.value }
    if (collectionId) next[sessionId] = collectionId
    else delete next[sessionId]
    selectionBySession.value = next
    saveStoredSelections(next)
    if (invalidatedSelection.value?.sessionId === sessionId) invalidatedSelection.value = null
  }

  /**
   * Make sure the collection list (and therefore selection validation) has
   * run before a restored selection is used. Safe to call repeatedly: the
   * list itself is only fetched once.
   */
  async function ensureSelectionValidated(sessionId: string | null | undefined): Promise<RagCollection | null> {
    if (!sessionId) return null
    await ensureCollections()
    return selectionFor(sessionId)
  }

  function dismissInvalidatedNotice(sessionId?: string): void {
    if (!sessionId || invalidatedSelection.value?.sessionId === sessionId) {
      invalidatedSelection.value = null
    }
  }

  return {
    collections,
    collectionsLoading,
    collectionsLoaded,
    selectionBySession,
    invalidatedSelection,
    selectableCollections,
    collectionById,
    ensureCollections,
    pruneInvalidSelections,
    selectionFor,
    selectForSession,
    ensureSelectionValidated,
    dismissInvalidatedNotice,
  }
})
