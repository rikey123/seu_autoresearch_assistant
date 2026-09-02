<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NInput, NPopconfirm, NSelect, NSpin, NTag } from 'naive-ui'
import ResearchPageShell from './ResearchPageShell.vue'
import { useKnowledgeStore } from '@/stores/research/knowledge'
import { usePapersStore } from '@/stores/research/papers'
import type { RagCitation, RagIndexStatus } from '@/api/studio/research-knowledge'

const router = useRouter()
const { t } = useI18n()
const store = useKnowledgeStore()
const papersStore = usePapersStore()

const newCollectionName = ref('')
const newCollectionDescription = ref('')
const creating = ref(false)
const showCreateForm = ref(false)

const selectedPaperId = ref<string | null>(null)
const questionText = ref('')

const indexStatusType: Record<RagIndexStatus, 'default' | 'info' | 'success' | 'warning'> = {
  unindexed: 'default',
  indexing: 'info',
  indexed: 'success',
  stale: 'warning',
}

const memberChoices = computed(() =>
  papersStore.papers
    .filter(paper => !store.members.some(member => member.paper_id === paper.id))
    .map(paper => ({ label: paper.title || paper.original_name, value: paper.id })),
)

function statusLabel(status: RagIndexStatus): string {
  return t(`research.rag.status.${status}`)
}

async function onCreateCollection(): Promise<void> {
  if (!newCollectionName.value.trim()) return
  creating.value = true
  const created = await store.create(newCollectionName.value.trim(), newCollectionDescription.value.trim())
  creating.value = false
  if (created) {
    newCollectionName.value = ''
    newCollectionDescription.value = ''
    showCreateForm.value = false
  }
}

function onSelectCollection(id: string): void {
  store.select(id)
}

async function onAddMember(): Promise<void> {
  if (!selectedPaperId.value) return
  const added = await store.addPaper(selectedPaperId.value)
  if (added) selectedPaperId.value = null
}

function openPaper(paperId: string): void {
  void router.push({ name: 'research.papers.preview', params: { paperId } })
}

function citationPageLabel(citation: RagCitation): string {
  return citation.page == null ? t('research.rag.citationPageMissing') : t('research.rag.citationPage', { page: citation.page })
}

async function onAsk(): Promise<void> {
  const question = questionText.value.trim()
  if (!question) return
  const answered = await store.ask(question)
  if (answered) questionText.value = ''
}

onMounted(() => {
  void store.refresh()
  void papersStore.refresh()
})
</script>

<template>
  <ResearchPageShell section="knowledge">
    <template #content>
      <div class="knowledge-view">
        <p v-if="store.notice" class="knowledge-notice" role="alert">
          {{ t(store.notice.key) }}
          <span v-if="store.notice.detail" class="knowledge-notice-detail">{{ store.notice.detail }}</span>
        </p>

        <div class="knowledge-layout">
          <aside class="knowledge-collections">
            <div class="collections-toolbar">
              <NButton size="small" type="primary" @click="showCreateForm = !showCreateForm">
                {{ t('research.rag.newCollection') }}
              </NButton>
            </div>
            <div v-if="showCreateForm" class="collection-create">
              <NInput
                v-model:value="newCollectionName"
                size="small"
                :placeholder="t('research.rag.namePlaceholder')"
                @keydown.enter="onCreateCollection"
              />
              <NInput
                v-model:value="newCollectionDescription"
                size="small"
                type="text"
                :placeholder="t('research.rag.descriptionPlaceholder')"
              />
              <NButton size="small" :loading="creating" @click="onCreateCollection">
                {{ t('research.rag.create') }}
              </NButton>
            </div>

            <div v-if="store.loading" class="knowledge-state">
              <NSpin size="small" />
              <span>{{ t('research.rag.loading') }}</span>
            </div>
            <div v-else-if="store.loadFailed" class="knowledge-state">
              <span>{{ t('research.rag.loadFailed') }}</span>
              <NButton size="small" @click="store.refresh()">{{ t('research.rag.retry') }}</NButton>
            </div>
            <NEmpty
              v-else-if="store.collections.length === 0"
              :description="t('research.rag.empty')"
              class="knowledge-empty"
            />
            <ul v-else class="collection-list">
              <li
                v-for="collection in store.collections"
                :key="collection.id"
                class="collection-item"
                :class="{ active: collection.id === store.selectedId }"
              >
                <button type="button" class="collection-main" @click="onSelectCollection(collection.id)">
                  <span class="collection-name">{{ collection.name }}</span>
                  <span class="collection-meta">
                    {{ t('research.rag.paperCount', { count: collection.paper_count ?? 0 }) }}
                  </span>
                </button>
                <NTag size="small" :type="indexStatusType[collection.index_status]" :bordered="false">
                  {{ statusLabel(collection.index_status) }}
                </NTag>
                <NPopconfirm
                  :show-icon="false"
                  :positive-text="t('research.rag.delete')"
                  :negative-text="t('research.rag.cancel')"
                  @positive-click="store.remove(collection.id)"
                >
                  <template #trigger>
                    <NButton
                      size="tiny"
                      quaternary
                      :loading="store.deletingIds.includes(collection.id)"
                      :aria-label="`${t('research.rag.delete')} ${collection.name}`"
                    >
                      {{ t('research.rag.delete') }}
                    </NButton>
                  </template>
                  {{ t('research.rag.deleteConfirmText', { name: collection.name }) }}
                </NPopconfirm>
              </li>
            </ul>
          </aside>

          <section v-if="store.selected" class="knowledge-detail">
            <header class="detail-header">
              <div class="detail-titles">
                <h3 class="detail-name">{{ store.selected.name }}</h3>
                <p v-if="store.selected.description" class="detail-description">{{ store.selected.description }}</p>
              </div>
              <div class="detail-actions">
                <NButton
                  size="small"
                  type="primary"
                  :loading="store.indexing"
                  :disabled="store.selected.index_status === 'indexing' || (store.selected.paper_count ?? 0) === 0"
                  @click="store.startIndexing()"
                >
                  {{ store.selected.index_status === 'unindexed'
                    ? t('research.rag.index')
                    : t('research.rag.reindex') }}
                </NButton>
              </div>
            </header>

            <p class="index-info">
              <NTag size="small" :type="indexStatusType[store.selected.index_status]" :bordered="false">
                {{ statusLabel(store.selected.index_status) }}
              </NTag>
              <span v-if="store.selected.index_status === 'indexed' || store.selected.chunks > 0" class="index-chunks">
                {{ t('research.rag.chunks', { count: store.selected.chunks, engine: store.selected.engine }) }}
              </span>
              <span v-if="store.latestJob?.status === 'failed' && store.latestJob.error" class="index-error">
                {{ store.latestJob.error }}
              </span>
            </p>

            <section class="members-section">
              <h4 class="section-title">{{ t('research.rag.membersTitle') }}</h4>
              <div class="member-picker">
                <NSelect
                  v-model:value="selectedPaperId"
                  size="small"
                  clearable
                  :options="memberChoices"
                  :placeholder="t('research.rag.memberPlaceholder')"
                  :loading="papersStore.loading"
                  class="member-select"
                />
                <NButton size="small" :disabled="!selectedPaperId" @click="onAddMember">
                  {{ t('research.rag.memberAdd') }}
                </NButton>
              </div>
              <div v-if="store.membersLoading" class="knowledge-state">
                <NSpin size="small" />
              </div>
              <NEmpty
                v-else-if="store.members.length === 0"
                :description="t('research.rag.membersEmpty')"
                class="members-empty"
              />
              <ul v-else class="member-list">
                <li v-for="member in store.members" :key="member.paper_id" class="member-item">
                  <button type="button" class="member-main" @click="openPaper(member.paper_id)">
                    <span class="member-title">{{ member.title || member.original_name }}</span>
                    <NTag v-if="!member.file_exists" size="small" type="error" :bordered="false">
                      {{ t('research.rag.memberFileMissing') }}
                    </NTag>
                  </button>
                  <NPopconfirm
                    :show-icon="false"
                    :positive-text="t('research.rag.memberRemove')"
                    :negative-text="t('research.rag.cancel')"
                    @positive-click="store.removePaper(member.paper_id)"
                  >
                    <template #trigger>
                      <NButton size="tiny" quaternary>
                        {{ t('research.rag.memberRemove') }}
                      </NButton>
                    </template>
                    {{ t('research.rag.memberRemoveConfirmText', { name: member.title || member.original_name }) }}
                  </NPopconfirm>
                </li>
              </ul>
            </section>

            <section class="ask-section">
              <h4 class="section-title">{{ t('research.rag.askTitle') }}</h4>
              <div class="ask-input">
                <NInput
                  v-model:value="questionText"
                  type="textarea"
                  :rows="2"
                  :placeholder="t('research.rag.questionPlaceholder')"
                  :disabled="store.selected.index_status === 'unindexed'"
                  @keydown.enter.exact.prevent="onAsk"
                />
                <NButton
                  type="primary"
                  size="small"
                  :loading="store.asking"
                  :disabled="store.selected.index_status === 'unindexed' || !questionText.trim()"
                  @click="onAsk"
                >
                  {{ t('research.rag.ask') }}
                </NButton>
              </div>
              <p v-if="store.selected.index_status === 'unindexed'" class="ask-hint">
                {{ t('research.rag.askNeedsIndex') }}
              </p>

              <div v-if="store.historyLoading" class="knowledge-state">
                <NSpin size="small" />
              </div>
              <NEmpty
                v-else-if="store.history.length === 0"
                :description="t('research.rag.historyEmpty')"
                class="history-empty"
              />
              <ul v-else class="history-list">
                <li v-for="entry in store.history" :key="entry.id" class="history-item">
                  <p class="history-question">{{ entry.question }}</p>
                  <div v-if="entry.status === 'answered'" class="history-answer">
                    <p class="answer-text">{{ entry.answer }}</p>
                    <ul v-if="entry.citations.length" class="citation-list">
                      <li v-for="(citation, index) in entry.citations" :key="`${entry.id}-${index}`" class="citation-item">
                        <button type="button" class="citation-main" @click="openPaper(citation.paperId)">
                          <span class="citation-index">[{{ index + 1 }}]</span>
                          <span class="citation-page">{{ citationPageLabel(citation) }}</span>
                          <span class="citation-snippet">{{ citation.snippet }}</span>
                        </button>
                      </li>
                    </ul>
                  </div>
                  <div v-else-if="entry.status === 'failed'" class="history-failed">
                    <span>{{ t('research.rag.questionFailed') }}</span>
                    <span v-if="entry.error" class="history-error">{{ entry.error }}</span>
                  </div>
                  <div v-else class="history-pending">
                    <NSpin size="small" />
                    <span>{{ t('research.rag.questionPending') }}</span>
                  </div>
                </li>
              </ul>
            </section>
          </section>

          <section v-else class="knowledge-placeholder-detail">
            <NEmpty :description="t('research.rag.selectHint')" class="knowledge-empty" />
          </section>
        </div>
      </div>
    </template>
  </ResearchPageShell>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.knowledge-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.knowledge-notice {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: $text-primary;
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
}

.knowledge-notice-detail {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: $text-secondary;
  word-break: break-all;
}

.knowledge-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.knowledge-collections {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 280px;
}

.collections-toolbar {
  display: flex;
  justify-content: flex-end;
}

.collection-create {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.knowledge-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  font-size: 13px;
  color: $text-secondary;
}

.knowledge-empty {
  padding: 24px 16px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}

.collection-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.collection-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  transition: border-color $transition-fast;

  &:hover {
    border-color: $accent-muted;
  }

  &.active {
    border-color: $accent-primary;
  }
}

.collection-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 0;
  text-align: start;
  background: transparent;
  border: none;
  cursor: pointer;
}

.collection-name {
  font-size: 13px;
  font-weight: 600;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-meta {
  font-size: 12px;
  color: $text-secondary;
}

.knowledge-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-width: 0;
}

.knowledge-placeholder-detail {
  flex: 1;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-name {
  margin: 0;
  font-size: 16px;
  color: $text-primary;
}

.detail-description {
  margin: 4px 0 0;
  font-size: 13px;
  color: $text-secondary;
}

.index-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  color: $text-secondary;
}

.index-chunks {
  font-variant-numeric: tabular-nums;
}

.index-error {
  width: 100%;
  font-size: 12px;
  color: $error;
  word-break: break-all;
}

.section-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
}

.members-section,
.ask-section {
  display: flex;
  flex-direction: column;
}

.member-picker {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.member-select {
  flex: 1;
  max-width: 380px;
}

.members-empty,
.history-empty {
  padding: 16px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.member-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0;
  text-align: start;
  background: transparent;
  border: none;
  cursor: pointer;
}

.member-title {
  font-size: 13px;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .member-main:hover & {
    color: $accent-primary;
  }
}

.ask-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ask-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: $text-muted;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.history-question {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: $text-primary;
}

.answer-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: $text-primary;
  white-space: pre-wrap;
}

.citation-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.citation-main {
  display: flex;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  padding: 4px 6px;
  text-align: start;
  font-size: 12px;
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  cursor: pointer;

  &:hover {
    border-color: $accent-muted;
  }
}

.citation-index {
  color: $accent-primary;
  font-variant-numeric: tabular-nums;
}

.citation-page {
  flex-shrink: 0;
  color: $text-secondary;
}

.citation-snippet {
  color: $text-secondary;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.history-failed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: $error;
}

.history-error {
  word-break: break-all;
}

.history-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: $text-secondary;
}
</style>
