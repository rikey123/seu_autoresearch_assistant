import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as artifactsApi from '@/api/studio/research-artifacts'
import type { ArtifactRecord, ArtifactType } from '@/api/studio/research-artifacts'

export type ArtifactsNotice = { kind: 'error' | 'success'; key: string }
export type ArtifactTypeFilter = '' | ArtifactType

// Client state for the research artifact registry: listing with a server-side
// type filter, client-side keyword filtering (the API has no keyword param),
// and deletion. Artifacts are registry rows only — deletion removes the
// record, no files are involved.
export const useArtifactsStore = defineStore('research-artifacts', () => {
  const artifacts = ref<ArtifactRecord[]>([])
  const loading = ref(false)
  const loadFailed = ref(false)
  const deletingIds = ref<string[]>([])
  const notice = ref<ArtifactsNotice | null>(null)
  const typeFilter = ref<ArtifactTypeFilter>('')
  const keyword = ref('')

  const totalCount = computed(() => artifacts.value.length)

  const filteredArtifacts = computed(() => {
    const query = keyword.value.trim().toLowerCase()
    if (!query) return artifacts.value
    // Keyword filtering runs client-side because the registry API only
    // supports type/project_id query params.
    return artifacts.value.filter(artifact =>
      artifact.title.toLowerCase().includes(query)
      || (artifact.source_run_id ?? '').toLowerCase().includes(query),
    )
  })

  async function refresh(): Promise<void> {
    loading.value = true
    loadFailed.value = false
    try {
      artifacts.value = await artifactsApi.listArtifacts(typeFilter.value || undefined)
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  function setTypeFilter(type: ArtifactTypeFilter): void {
    typeFilter.value = type
    void refresh()
  }

  function setKeyword(value: string): void {
    keyword.value = value
  }

  async function removeArtifact(id: string): Promise<boolean> {
    deletingIds.value = [...deletingIds.value, id]
    try {
      await artifactsApi.deleteArtifact(id)
      artifacts.value = artifacts.value.filter(artifact => artifact.id !== id)
      notice.value = { kind: 'success', key: 'research.artifacts.deleteSuccess' }
      return true
    } catch {
      notice.value = { kind: 'error', key: 'research.artifacts.deleteFailed' }
      return false
    } finally {
      deletingIds.value = deletingIds.value.filter(entry => entry !== id)
    }
  }

  function clearNotice(): void {
    notice.value = null
  }

  return {
    artifacts,
    loading,
    loadFailed,
    deletingIds,
    notice,
    typeFilter,
    keyword,
    totalCount,
    filteredArtifacts,
    refresh,
    setTypeFilter,
    setKeyword,
    removeArtifact,
    clearNotice,
  }
})
