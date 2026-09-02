import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as knowledgeApi from '@/api/studio/research-knowledge'
import type {
  RagCollection,
  RagCollectionMember,
  RagIndexJob,
  RagQuestion,
} from '@/api/studio/research-knowledge'

export type KnowledgeNotice = { kind: 'error' | 'success'; key: string; detail?: string }

// Polling guardrails for index/ask tasks. The sidecar's own execution timeout
// is 10 minutes, so 15 minutes of client polling (matching the chat KB ask
// deadline) always covers the server-side lifecycle; beyond that the task is
// never going to converge and the store must give up instead of spinning
// forever. A collection switch mid-poll also aborts immediately: the client
// renders one collection at a time and a job/question from the previous
// selection must never be written into the new one's view.
export const KNOWLEDGE_POLL_INTERVAL_MS = 500
export const KNOWLEDGE_POLL_TIMEOUT_MS = 15 * 60 * 1000

// Client state for the RAG knowledge base: collections, membership, index
// jobs, and the cited Q&A panel. Index/ask tasks are queued server-side; the
// store polls their persisted records until they reach a terminal state.
export const useKnowledgeStore = defineStore('research-knowledge', () => {
  const collections = ref<RagCollection[]>([])
  const loading = ref(false)
  const loadFailed = ref(false)
  const notice = ref<KnowledgeNotice | null>(null)

  const selectedId = ref<string | null>(null)
  const members = ref<RagCollectionMember[]>([])
  const membersLoading = ref(false)
  const latestJob = ref<RagIndexJob | null>(null)
  const indexing = ref(false)
  const history = ref<RagQuestion[]>([])
  const historyLoading = ref(false)
  const asking = ref(false)
  const pendingQuestionIds = ref<string[]>([])
  const deletingIds = ref<string[]>([])

  const selected = computed(() =>
    collections.value.find(collection => collection.id === selectedId.value) || null,
  )
  const pendingQuestions = computed(() =>
    history.value.filter(question => pendingQuestionIds.value.includes(question.id)),
  )

  function collectionById(id: string): RagCollection | null {
    return collections.value.find(collection => collection.id === id) || null
  }

  function replaceCollection(next: RagCollection): void {
    const index = collections.value.findIndex(collection => collection.id === next.id)
    if (index >= 0) collections.value[index] = next
    else collections.value = [next, ...collections.value]
  }

  function errorDetail(error: unknown): string | undefined {
    const detail = (error as { message?: string } | null)?.message
    return detail ? detail.slice(0, 300) : undefined
  }

  async function refresh(): Promise<void> {
    loading.value = true
    loadFailed.value = false
    try {
      collections.value = await knowledgeApi.listCollections()
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  function select(id: string | null): void {
    selectedId.value = id
    members.value = []
    latestJob.value = null
    history.value = []
    pendingQuestionIds.value = []
    if (id) {
      void refreshMembers()
      void refreshHistory()
    }
  }

  async function refreshMembers(): Promise<void> {
    if (!selectedId.value) return
    membersLoading.value = true
    try {
      members.value = await knowledgeApi.listMembers(selectedId.value)
    } catch {
      members.value = []
    } finally {
      membersLoading.value = false
    }
  }

  async function refreshHistory(): Promise<void> {
    if (!selectedId.value) return
    historyLoading.value = true
    try {
      history.value = await knowledgeApi.getHistory(selectedId.value)
    } catch {
      history.value = []
    } finally {
      historyLoading.value = false
    }
  }

  async function create(name: string, description: string): Promise<boolean> {
    try {
      const collection = await knowledgeApi.createCollection(name, description)
      collections.value = [collection, ...collections.value]
      notice.value = { kind: 'success', key: 'research.rag.created' }
      return true
    } catch (error) {
      notice.value = { kind: 'error', key: 'research.rag.createFailed', detail: errorDetail(error) }
      return false
    }
  }

  async function remove(id: string): Promise<boolean> {
    deletingIds.value = [...deletingIds.value, id]
    try {
      await knowledgeApi.deleteCollection(id)
      collections.value = collections.value.filter(collection => collection.id !== id)
      if (selectedId.value === id) select(null)
      notice.value = { kind: 'success', key: 'research.rag.deleted' }
      return true
    } catch {
      notice.value = { kind: 'error', key: 'research.rag.deleteFailed' }
      return false
    } finally {
      deletingIds.value = deletingIds.value.filter(entry => entry !== id)
    }
  }

  async function addPaper(paperId: string): Promise<boolean> {
    if (!selectedId.value) return false
    try {
      const member = await knowledgeApi.addMember(selectedId.value, paperId)
      if (!members.value.some(entry => entry.paper_id === member.paper_id)) {
        members.value = [...members.value, member]
      }
      const collection = collectionById(selectedId.value)
      if (collection) {
        replaceCollection({
          ...collection,
          paper_count: (collection.paper_count ?? 0) + 1,
          index_status: collection.index_status === 'indexed' ? 'stale' : collection.index_status,
        })
      }
      notice.value = { kind: 'success', key: 'research.rag.memberAdded' }
      return true
    } catch (error) {
      notice.value = { kind: 'error', key: 'research.rag.memberAddFailed', detail: errorDetail(error) }
      return false
    }
  }

  async function removePaper(paperId: string): Promise<boolean> {
    if (!selectedId.value) return false
    try {
      await knowledgeApi.removeMember(selectedId.value, paperId)
      members.value = members.value.filter(entry => entry.paper_id !== paperId)
      const collection = collectionById(selectedId.value)
      if (collection) {
        replaceCollection({
          ...collection,
          paper_count: Math.max(0, (collection.paper_count ?? 1) - 1),
          index_status: collection.index_status === 'indexed' ? 'stale' : collection.index_status,
        })
      }
      notice.value = { kind: 'success', key: 'research.rag.memberRemoved' }
      return true
    } catch {
      notice.value = { kind: 'error', key: 'research.rag.memberRemoveFailed' }
      return false
    }
  }

  /** Enqueue an index job and poll it until it reaches a terminal state. */
  async function startIndexing(): Promise<boolean> {
    const id = selectedId.value
    if (!id) return false
    indexing.value = true
    try {
      const job = await knowledgeApi.startIndexing(id)
      latestJob.value = job
      const collection = collectionById(id)
      if (collection) replaceCollection({ ...collection, index_status: 'indexing' })
      const terminal = await pollIndexJob(job.id, id)
      latestJob.value = terminal
      await Promise.all([refreshCollection(id), refreshMembers()])
      if (terminal.status === 'completed') {
        notice.value = { kind: 'success', key: 'research.rag.indexCompleted' }
        return true
      }
      notice.value = {
        kind: 'error',
        key: 'research.rag.indexFailed',
        detail: terminal.error || undefined,
      }
      return false
    } catch (error) {
      notice.value = { kind: 'error', key: 'research.rag.indexFailed', detail: errorDetail(error) }
      return false
    } finally {
      indexing.value = false
    }
  }

  async function pollIndexJob(jobId: string, collectionId: string): Promise<RagIndexJob> {
    const deadline = Date.now() + KNOWLEDGE_POLL_TIMEOUT_MS
    for (;;) {
      // A collection switch invalidates the poll target immediately: the
      // selected library changed, so this job belongs to a view the user left.
      if (selectedId.value !== collectionId) {
        throw new Error('the knowledge base selection changed while the index job was running')
      }
      const job = await knowledgeApi.getLatestIndexJob(collectionId)
      if (job && job.id === jobId) {
        if (job.status === 'completed' || job.status === 'failed') return job
      } else if (job) {
        throw new Error('the index job id no longer matches the latest job of the selected knowledge base')
      }
      if (Date.now() > deadline) {
        throw new Error('the index job did not reach a terminal state within the polling timeout (15 minutes)')
      }
      await new Promise(resolve => setTimeout(resolve, KNOWLEDGE_POLL_INTERVAL_MS))
    }
  }

  async function refreshCollection(id: string): Promise<void> {
    const listed = await knowledgeApi.listCollections()
    collections.value = listed
    const fresh = listed.find(entry => entry.id === id)
    if (fresh && selectedId.value === id) replaceCollection(fresh)
  }

  /** Submit a question and poll until it is answered or fails. */
  async function ask(question: string): Promise<boolean> {
    const id = selectedId.value
    if (!id) return false
    asking.value = true
    let submittedId = ''
    try {
      const submitted = await knowledgeApi.askQuestion(id, question)
      submittedId = submitted.id
      history.value = [submitted, ...history.value]
      pendingQuestionIds.value = [...pendingQuestionIds.value, submitted.id]
      const terminal = await pollQuestion(submitted.id, id)
      history.value = history.value.map(entry => (entry.id === terminal.id ? terminal : entry))
      pendingQuestionIds.value = pendingQuestionIds.value.filter(entry => entry !== terminal.id)
      if (terminal.status === 'answered') return true
      notice.value = {
        kind: 'error',
        key: 'research.rag.askFailed',
        detail: terminal.error || undefined,
      }
      return false
    } catch (error) {
      if (submittedId) {
        pendingQuestionIds.value = pendingQuestionIds.value.filter(entry => entry !== submittedId)
      }
      notice.value = { kind: 'error', key: 'research.rag.askFailed', detail: errorDetail(error) }
      return false
    } finally {
      asking.value = false
    }
  }

  async function pollQuestion(questionId: string, collectionId: string): Promise<RagQuestion> {
    const deadline = Date.now() + KNOWLEDGE_POLL_TIMEOUT_MS
    for (;;) {
      // The ask belongs to the collection that was selected at submit time;
      // once the user switches collections the local history is replaced, so
      // an old record must never be written into the new view.
      if (selectedId.value !== collectionId) {
        throw new Error('the knowledge base selection changed while the question was running')
      }
      const record = await knowledgeApi.getQuestion(questionId)
      if (record.id !== questionId) {
        throw new Error('the question id no longer matches the persisted question record')
      }
      if (record.status === 'answered' || record.status === 'failed') return record
      if (Date.now() > deadline) {
        throw new Error('the question did not reach a terminal state within the polling timeout (15 minutes)')
      }
      await new Promise(resolve => setTimeout(resolve, KNOWLEDGE_POLL_INTERVAL_MS))
    }
  }

  function clearNotice(): void {
    notice.value = null
  }

  return {
    collections,
    loading,
    loadFailed,
    notice,
    selectedId,
    selected,
    members,
    membersLoading,
    latestJob,
    indexing,
    history,
    historyLoading,
    asking,
    pendingQuestionIds,
    pendingQuestions,
    deletingIds,
    collectionById,
    refresh,
    select,
    refreshMembers,
    refreshHistory,
    create,
    remove,
    addPaper,
    removePaper,
    startIndexing,
    ask,
    clearNotice,
  }
})
