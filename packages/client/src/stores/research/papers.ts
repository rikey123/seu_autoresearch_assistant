import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as libraryApi from '@/api/studio/research-library'
import type { PaperRecord } from '@/api/studio/research-library'

export type PapersNotice = { kind: 'error' | 'success'; key: string }

// Client state for the research paper library: listing, PDF import, and
// deletion. The preview itself is a route that streams bytes from the server.
export const usePapersStore = defineStore('research-papers', () => {
  const papers = ref<PaperRecord[]>([])
  const loading = ref(false)
  const loadFailed = ref(false)
  const uploading = ref(false)
  const deletingIds = ref<string[]>([])
  const notice = ref<PapersNotice | null>(null)

  const totalCount = computed(() => papers.value.length)

  function paperById(id: string): PaperRecord | null {
    return papers.value.find(paper => paper.id === id) || null
  }

  async function refresh(): Promise<void> {
    loading.value = true
    loadFailed.value = false
    try {
      papers.value = await libraryApi.listPapers()
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  async function importPaper(file: File): Promise<boolean> {
    uploading.value = true
    try {
      await libraryApi.uploadPaper(file)
      notice.value = { kind: 'success', key: 'research.papers.uploadSuccess' }
      await refresh()
      return true
    } catch {
      notice.value = { kind: 'error', key: 'research.papers.uploadFailed' }
      return false
    } finally {
      uploading.value = false
    }
  }

  async function removePaper(id: string): Promise<boolean> {
    deletingIds.value = [...deletingIds.value, id]
    try {
      await libraryApi.deletePaper(id)
      papers.value = papers.value.filter(paper => paper.id !== id)
      notice.value = { kind: 'success', key: 'research.papers.deleteSuccess' }
      return true
    } catch {
      notice.value = { kind: 'error', key: 'research.papers.deleteFailed' }
      return false
    } finally {
      deletingIds.value = deletingIds.value.filter(entry => entry !== id)
    }
  }

  function clearNotice(): void {
    notice.value = null
  }

  return {
    papers,
    loading,
    loadFailed,
    uploading,
    deletingIds,
    notice,
    totalCount,
    paperById,
    refresh,
    importPaper,
    removePaper,
    clearNotice,
  }
})
