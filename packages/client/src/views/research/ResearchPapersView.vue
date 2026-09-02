<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NPopconfirm, NSpin, NTag, useMessage } from 'naive-ui'
import ResearchPageShell from './ResearchPageShell.vue'
import ArtifactToChatModal from './ArtifactToChatModal.vue'
import { usePapersStore } from '@/stores/research/papers'
import { useChatStore } from '@/stores/hermes/chat'
import type { PaperRecord } from '@/api/studio/research-library'
import { buildPaperChatMessageForId } from '@/utils/research-artifact-chat'
import { formatFileSize, formatImportedAt } from '@/utils/research-paper-format'

const router = useRouter()
const { t } = useI18n()
const toast = useMessage()
const store = usePapersStore()
const chatStore = useChatStore()

const fileInput = ref<HTMLInputElement | null>(null)

// Artifact-to-chat: pick a session, then deliver the paper reference through
// the regular chat send channel (no server protocol changes).
const sendModalOpen = ref(false)
const sendTargetPaper = ref<PaperRecord | null>(null)
const sendingToChat = ref(false)

function paperName(paper: PaperRecord): string {
  return paper.title || paper.original_name || t('research.papers.untitled')
}

function chooseFile(): void {
  fileInput.value?.click()
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await store.importPaper(file)
}

async function onConfirmDelete(paper: PaperRecord): Promise<void> {
  await store.removePaper(paper.id)
}

function openPreview(paper: PaperRecord): void {
  void router.push({ name: 'research.papers.preview', params: { paperId: paper.id } })
}

function openSendToChat(paper: PaperRecord): void {
  sendTargetPaper.value = paper
  sendModalOpen.value = true
}

const sendModalTitle = computed(() => (sendTargetPaper.value ? paperName(sendTargetPaper.value) : ''))
const sendMessageBody = computed(() =>
  sendTargetPaper.value ? buildPaperChatMessageForId(sendTargetPaper.value) : '',
)

async function handleSendToChat(sessionId: string | null): Promise<void> {
  const paper = sendTargetPaper.value
  if (!paper || sendingToChat.value) return
  sendingToChat.value = true
  try {
    if (sessionId) {
      await chatStore.switchSession(sessionId)
    }
    await chatStore.sendMessage(buildPaperChatMessageForId(paper))
    toast.success(t('research.papers.sendToChatSuccess'))
    sendModalOpen.value = false
    void router.push(
      sessionId
        ? { name: 'hermes.session', params: { sessionId } }
        : { name: 'hermes.chat' },
    )
  } catch {
    toast.error(t('research.papers.sendToChatFailed'))
  } finally {
    sendingToChat.value = false
  }
}

onMounted(() => {
  void store.refresh()
})
</script>

<template>
  <ResearchPageShell section="papers">
    <template #content>
      <div class="papers-view">
        <div class="papers-toolbar">
          <input
            ref="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            class="papers-file-input"
            :aria-label="t('research.papers.upload')"
            @change="onFileChosen"
          >
          <NButton type="primary" size="small" :loading="store.uploading" @click="chooseFile">
            {{ t('research.papers.upload') }}
          </NButton>
        </div>

        <p v-if="store.notice" class="papers-notice" role="alert">{{ t(store.notice.key) }}</p>

        <div v-if="store.loading" class="papers-state">
          <NSpin size="small" />
          <span>{{ t('research.papers.loading') }}</span>
        </div>
        <div v-else-if="store.loadFailed" class="papers-state">
          <span>{{ t('research.papers.loadFailed') }}</span>
          <NButton size="small" @click="store.refresh()">
            {{ t('research.papers.retry') }}
          </NButton>
        </div>
        <NEmpty
          v-else-if="store.papers.length === 0"
          :description="t('research.papers.empty')"
          class="papers-empty"
        />
        <ul v-else class="papers-collection">
          <li v-for="paper in store.papers" :key="paper.id" class="paper-item">
            <button type="button" class="paper-main" @click="openPreview(paper)">
              <span class="paper-title">{{ paperName(paper) }}</span>
              <span v-if="paper.original_name && paper.original_name !== paperName(paper)" class="paper-file">
                {{ paper.original_name }}
              </span>
            </button>
            <span class="paper-size">{{ formatFileSize(paper.file_size) }}</span>
            <span class="paper-time">{{ formatImportedAt(paper.created_at) }}</span>
            <span v-if="paper.tags.length" class="paper-tags">
              <NTag v-for="tag in paper.tags" :key="tag" size="small" :bordered="false">{{ tag }}</NTag>
            </span>
            <NButton
              size="tiny"
              quaternary
              class="paper-send-chat"
              data-testid="paper-send-to-chat"
              :aria-label="`${t('research.papers.sendToChat')} ${paperName(paper)}`"
              @click.stop="openSendToChat(paper)"
            >
              {{ t('research.papers.sendToChat') }}
            </NButton>
            <NPopconfirm
              :show-icon="false"
              :positive-text="t('research.papers.deleteConfirm')"
              :negative-text="t('research.papers.cancel')"
              @positive-click="onConfirmDelete(paper)"
            >
              <template #trigger>
                <NButton
                  size="tiny"
                  quaternary
                  class="paper-delete"
                  :loading="store.deletingIds.includes(paper.id)"
                  :aria-label="`${t('research.papers.delete')} ${paperName(paper)}`"
                >
                  {{ t('research.papers.delete') }}
                </NButton>
              </template>
              {{ t('research.papers.deleteConfirmText', { name: paperName(paper) }) }}
            </NPopconfirm>
          </li>
        </ul>
      </div>
    </template>
  </ResearchPageShell>
  <ArtifactToChatModal
    v-model:show="sendModalOpen"
    :artifact-title="sendModalTitle"
    :message-body="sendMessageBody"
    :sending="sendingToChat"
    @send="handleSendToChat"
  />
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.papers-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.papers-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.papers-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.papers-notice {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: $text-primary;
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
}

.papers-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  font-size: 13px;
  color: $text-secondary;
}

.papers-empty {
  padding: 40px 24px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}

.papers-collection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.paper-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  transition: border-color $transition-fast;

  &:hover {
    border-color: $accent-muted;
  }
}

.paper-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 4px 8px 4px 0;
  text-align: start;
  background: transparent;
  border: none;
  cursor: pointer;
}

.paper-title {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paper-file {
  font-size: 12px;
  color: $text-secondary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paper-size,
.paper-time {
  flex-shrink: 0;
  font-size: 12px;
  color: $text-secondary;
  font-variant-numeric: tabular-nums;
}

.paper-tags {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 4px;
}

.paper-send-chat {
  flex-shrink: 0;
}

.paper-delete {
  flex-shrink: 0;
}
</style>
