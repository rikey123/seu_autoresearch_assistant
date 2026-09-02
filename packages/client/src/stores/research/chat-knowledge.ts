import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as knowledgeApi from '@/api/studio/research-knowledge'
import type { RagCollection } from '@/api/studio/research-knowledge'

/**
 * Client state for @-mentioning a RAG knowledge base in the chat composer.
 * Holds the collection list for the mention popup and the per-session
 * knowledge base selection. The selection is per chat session and in-memory
 * only: an unanswered selection never changes what a plain chat run sends.
 */
export const useChatKnowledgeStore = defineStore('research-chat-knowledge', () => {
  const collections = ref<RagCollection[]>([])
  const collectionsLoading = ref(false)
  const collectionsLoaded = ref(false)
  const selectionBySession = ref<Record<string, string>>({})

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
    } catch {
      collections.value = []
      collectionsLoaded.value = false
    } finally {
      collectionsLoading.value = false
    }
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
  }

  return {
    collections,
    collectionsLoading,
    collectionsLoaded,
    selectionBySession,
    selectableCollections,
    collectionById,
    ensureCollections,
    selectionFor,
    selectForSession,
  }
})
