<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NInput, NModal, NPopconfirm, NSelect, NSpin, NTag, useMessage } from 'naive-ui'
import ResearchPageShell from './ResearchPageShell.vue'
import ArtifactToChatModal from './ArtifactToChatModal.vue'
import { useArtifactsStore, type ArtifactTypeFilter } from '@/stores/research/artifacts'
import { useChatStore } from '@/stores/hermes/chat'
import { ARTIFACT_TYPES, type ArtifactRecord, type ArtifactType } from '@/api/studio/research-artifacts'
import { buildArtifactChatMessage } from '@/utils/research-artifact-chat'
import { formatImportedAt } from '@/utils/research-paper-format'

const router = useRouter()
const { t } = useI18n()
const toast = useMessage()
const store = useArtifactsStore()
const chatStore = useChatStore()

const typeOptions = computed(() => [
  { label: t('research.artifacts.allTypes'), value: '' },
  ...ARTIFACT_TYPES.map(type => ({ label: typeLabel(type), value: type })),
])

function typeLabel(type: ArtifactType): string {
  return t(`research.artifacts.typeLabels.${type}`)
}

function artifactName(artifact: ArtifactRecord): string {
  return artifact.title || t('research.artifacts.untitled')
}

function artifactTime(artifact: ArtifactRecord): string {
  return formatImportedAt(artifact.updated_at)
}

// Source of an artifact: the workflow run that produced it, or a dash when the
// entry has no run reference (e.g. LaTeX compilations register without one).
function artifactSource(artifact: ArtifactRecord): string {
  return artifact.source_run_id || t('research.artifacts.sourceNone')
}

function onTypeFilterChange(value: unknown): void {
  store.setTypeFilter((value === '' ? '' : value) as ArtifactTypeFilter)
}

function onKeywordInput(value: string): void {
  store.setKeyword(value)
}

// Inline preview modal. The preview endpoint returns JSON metadata (real file
// previews arrive with workflow render nodes), so the modal shows identity and
// the preview payload; HTML artifacts that embed their document inline render
// it inside a fully sandboxed iframe with an escape-hatch "open in new window".
const previewOpen = ref(false)
const previewTarget = ref<ArtifactRecord | null>(null)

const previewHtml = computed<string | null>(() => {
  const preview = previewTarget.value?.preview
  if (!preview) return null
  return typeof preview.html === 'string' && preview.html.trim() ? preview.html : null
})

const previewSummary = computed<string>(() => {
  const preview = previewTarget.value?.preview
  if (!preview) return ''
  const entries = Object.entries(preview).filter(([key]) => key !== 'html')
  if (!entries.length) return ''
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join('\n')
})

function openPreview(artifact: ArtifactRecord): void {
  previewTarget.value = artifact
  previewOpen.value = true
}

function closePreview(): void {
  previewOpen.value = false
  previewTarget.value = null
}

let previewWindowUrl: string | null = null

function openHtmlInNewWindow(): void {
  const html = previewHtml.value
  if (!html) return
  if (previewWindowUrl) URL.revokeObjectURL(previewWindowUrl)
  previewWindowUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  window.open(previewWindowUrl, '_blank', 'noopener')
}

onBeforeUnmount(() => {
  if (previewWindowUrl) {
    URL.revokeObjectURL(previewWindowUrl)
    previewWindowUrl = null
  }
})

// Send-to-chat: reuse the shared session picker, then deliver the plain-text
// reference through the regular chat send channel.
const sendModalOpen = ref(false)
const sendTarget = ref<ArtifactRecord | null>(null)
const sendingToChat = ref(false)

function openSendToChat(artifact: ArtifactRecord): void {
  sendTarget.value = artifact
  sendModalOpen.value = true
}

const sendModalTitle = computed(() => (sendTarget.value ? artifactName(sendTarget.value) : ''))

async function handleSendToChat(sessionId: string | null): Promise<void> {
  const artifact = sendTarget.value
  if (!artifact || sendingToChat.value) return
  sendingToChat.value = true
  try {
    if (sessionId) {
      await chatStore.switchSession(sessionId)
    }
    await chatStore.sendMessage(buildArtifactChatMessage(artifact))
    toast.success(t('research.artifacts.sendToChatSuccess'))
    sendModalOpen.value = false
    void router.push(
      sessionId
        ? { name: 'hermes.session', params: { sessionId } }
        : { name: 'hermes.chat' },
    )
  } catch {
    toast.error(t('research.artifacts.sendToChatFailed'))
  } finally {
    sendingToChat.value = false
  }
}

async function onConfirmDelete(artifact: ArtifactRecord): Promise<void> {
  await store.removeArtifact(artifact.id)
}

onMounted(() => {
  void store.refresh()
})
</script>

<template>
  <ResearchPageShell section="artifacts">
    <template #content>
      <div class="artifacts-view">
        <div class="artifacts-toolbar">
          <NSelect
            class="artifacts-type-filter"
            :value="store.typeFilter"
            :options="typeOptions"
            size="small"
            data-testid="artifact-type-filter"
            @update:value="onTypeFilterChange"
          />
          <NInput
            class="artifacts-keyword"
            :value="store.keyword"
            size="small"
            clearable
            :placeholder="t('research.artifacts.keywordPlaceholder')"
            data-testid="artifact-keyword-input"
            @update:value="onKeywordInput"
          />
        </div>

        <p v-if="store.notice" class="artifacts-notice" role="alert">{{ t(store.notice.key) }}</p>

        <div v-if="store.loading" class="artifacts-state">
          <NSpin size="small" />
          <span>{{ t('research.artifacts.loading') }}</span>
        </div>
        <div v-else-if="store.loadFailed" class="artifacts-state">
          <span>{{ t('research.artifacts.loadFailed') }}</span>
          <NButton size="small" @click="store.refresh()">
            {{ t('research.artifacts.retry') }}
          </NButton>
        </div>
        <NEmpty
          v-else-if="store.artifacts.length === 0"
          data-testid="artifacts-empty"
          :description="t('research.artifacts.empty')"
          class="artifacts-empty"
        />
        <NEmpty
          v-else-if="store.filteredArtifacts.length === 0"
          data-testid="artifacts-filtered-empty"
          :description="t('research.artifacts.emptyFiltered')"
          class="artifacts-empty"
        />
        <ul v-else class="artifacts-collection">
          <li v-for="artifact in store.filteredArtifacts" :key="artifact.id" class="artifact-item">
            <button type="button" class="artifact-main" @click="openPreview(artifact)">
              <span class="artifact-title">{{ artifactName(artifact) }}</span>
              <span class="artifact-source" :data-testid="`artifact-source-${artifact.id}`">
                {{ artifactSource(artifact) }}
              </span>
            </button>
            <NTag size="small" :bordered="false" class="artifact-type">
              {{ typeLabel(artifact.type) }}
            </NTag>
            <span class="artifact-version">v{{ artifact.version }}</span>
            <span class="artifact-time">{{ artifactTime(artifact) }}</span>
            <NButton
              size="tiny"
              quaternary
              data-testid="artifact-preview"
              :aria-label="`${t('research.artifacts.preview')} ${artifactName(artifact)}`"
              @click.stop="openPreview(artifact)"
            >
              {{ t('research.artifacts.preview') }}
            </NButton>
            <NButton
              size="tiny"
              quaternary
              data-testid="artifact-send-to-chat"
              :aria-label="`${t('research.artifacts.sendToChat')} ${artifactName(artifact)}`"
              @click.stop="openSendToChat(artifact)"
            >
              {{ t('research.artifacts.sendToChat') }}
            </NButton>
            <NPopconfirm
              :show-icon="false"
              :positive-text="t('research.artifacts.deleteConfirm')"
              :negative-text="t('research.artifacts.cancel')"
              @positive-click="onConfirmDelete(artifact)"
            >
              <template #trigger>
                <NButton
                  size="tiny"
                  quaternary
                  class="artifact-delete"
                  data-testid="artifact-delete"
                  :loading="store.deletingIds.includes(artifact.id)"
                  :aria-label="`${t('research.artifacts.delete')} ${artifactName(artifact)}`"
                >
                  {{ t('research.artifacts.delete') }}
                </NButton>
              </template>
              {{ t('research.artifacts.deleteConfirmText', { name: artifactName(artifact) }) }}
            </NPopconfirm>
          </li>
        </ul>
      </div>
    </template>
  </ResearchPageShell>

  <NModal
    :show="previewOpen"
    @update:show="value => { if (!value) closePreview() }"
  >
    <div v-if="previewTarget" class="artifact-preview-modal" role="dialog" :aria-label="artifactName(previewTarget)">
      <header class="preview-modal-header">
        <h3 dir="auto">{{ artifactName(previewTarget) }}</h3>
        <div class="preview-modal-meta">
          <NTag size="small" :bordered="false">{{ typeLabel(previewTarget.type) }}</NTag>
          <span>v{{ previewTarget.version }}</span>
          <span>{{ artifactTime(previewTarget) }}</span>
        </div>
      </header>
      <template v-if="previewHtml">
        <iframe
          class="preview-frame"
          sandbox=""
          :srcdoc="previewHtml"
          :title="t('research.artifacts.previewFrame')"
        />
        <div class="preview-modal-footer">
          <NButton
            size="small"
            data-testid="artifact-open-new-window"
            @click="openHtmlInNewWindow"
          >
            {{ t('research.artifacts.openInNewWindow') }}
          </NButton>
        </div>
      </template>
      <template v-else>
        <span class="preview-summary-label">{{ t('research.artifacts.previewMetaTitle') }}</span>
        <pre class="preview-summary" data-testid="artifact-preview-summary" dir="auto">{{ previewSummary || t('research.artifacts.previewEmpty') }}</pre>
        <div class="preview-modal-footer">
          <NButton size="small" @click="closePreview">
            {{ t('research.artifacts.close') }}
          </NButton>
        </div>
      </template>
    </div>
  </NModal>

  <ArtifactToChatModal
    v-model:show="sendModalOpen"
    :artifact-title="sendModalTitle"
    :message-body="sendTarget ? buildArtifactChatMessage(sendTarget) : ''"
    :sending="sendingToChat"
    @send="handleSendToChat"
  />
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.artifacts-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.artifacts-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artifacts-type-filter {
  width: 160px;
  flex-shrink: 0;
}

.artifacts-keyword {
  max-width: 260px;
}

.artifacts-notice {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: $text-primary;
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
}

.artifacts-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  font-size: 13px;
  color: $text-secondary;
}

.artifacts-empty {
  padding: 40px 24px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}

.artifacts-collection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.artifact-item {
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

.artifact-main {
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

.artifact-title {
  max-width: 100%;
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-source {
  max-width: 100%;
  font-size: 12px;
  color: $text-secondary;
  font-family: $font-code;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-type {
  flex-shrink: 0;
}

.artifact-version,
.artifact-time {
  flex-shrink: 0;
  font-size: 12px;
  color: $text-secondary;
  font-variant-numeric: tabular-nums;
}

.artifact-delete {
  flex-shrink: 0;
}

.artifact-preview-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(720px, calc(100vw - 32px));
  max-height: min(640px, calc(100 * var(--vh) - 48px));
  padding: 16px;
  background: var(--bg-main-surface, $bg-card);
  border: 1px solid $border-color;
  border-radius: $radius-md;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}

.preview-modal-header {
  display: flex;
  flex-direction: column;
  gap: 6px;

  h3 {
    margin: 0;
    font-size: 15px;
    color: $text-primary;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.preview-modal-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: $text-secondary;
  font-variant-numeric: tabular-nums;
}

.preview-frame {
  width: 100%;
  height: 380px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: #fff;
}

.preview-summary-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: $text-muted;
}

.preview-summary {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: $bg-secondary;
  font-family: $font-code;
  font-size: 12px;
  line-height: 1.5;
  color: $text-secondary;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
