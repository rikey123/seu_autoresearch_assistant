<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NModal, NSpin } from 'naive-ui'
import { useChatStore } from '@/stores/hermes/chat'

// Session picker for "send artifact to chat": choose an existing conversation
// or a fresh chat, then the caller delivers the prepared message through the
// regular chat send channel.
const props = defineProps<{
  show: boolean
  artifactTitle: string
  messageBody: string
  sending?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'send', sessionId: string | null): void
}>()

const chatStore = useChatStore()
const { t } = useI18n()

const selectedSessionId = ref<string | null>(null)
const loadingSessions = ref(false)
let loadAttempted = false

watch(() => props.show, async (show) => {
  if (!show) return
  selectedSessionId.value = null
  if (!loadAttempted && !chatStore.sessionsLoaded) {
    loadAttempted = true
    loadingSessions.value = true
    try {
      await chatStore.loadSessions()
    } catch {
      // the list stays empty; the new-chat option still works
    } finally {
      loadingSessions.value = false
    }
  }
})

const sessions = computed(() =>
  [...chatStore.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
)

function sessionTitle(title: string): string {
  // Reuses the shared "untitled conversation" label already localized for the
  // realtime voice stage.
  return title || t('realtimeVoice.untitledSession')
}

function close(): void {
  emit('update:show', false)
}

function confirmSend(): void {
  emit('send', selectedSessionId.value)
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="!sending"
    @update:show="value => emit('update:show', value)"
  >
    <div class="artifact-send-modal" role="dialog" :aria-label="t('research.papers.sendToChatTitle')">
      <header class="send-modal-header">
        <h3>{{ t('research.papers.sendToChatTitle') }}</h3>
        <p class="artifact-name" dir="auto">{{ artifactTitle }}</p>
      </header>

      <div class="session-picker" data-testid="artifact-send-session-picker">
        <div v-if="loadingSessions" class="picker-state">
          <NSpin size="small" />
          <span>{{ t('research.papers.sendToChatLoading') }}</span>
        </div>
        <template v-else>
          <button
            type="button"
            class="session-option"
            :class="{ active: selectedSessionId === null }"
            data-testid="artifact-send-new-session"
            @click="selectedSessionId = null"
          >
            {{ t('research.papers.sendToChatNewSession') }}
          </button>
          <NEmpty
            v-if="sessions.length === 0"
            size="small"
            :description="t('research.papers.sendToChatEmpty')"
            class="picker-empty"
          />
          <template v-else>
            <button
              v-for="session in sessions"
              :key="session.id"
              type="button"
              class="session-option"
              :class="{ active: selectedSessionId === session.id }"
              :data-session-id="session.id"
              @click="selectedSessionId = session.id"
            >
              <span class="session-title" dir="auto">{{ sessionTitle(session.title) }}</span>
              <span v-if="session.profile" class="session-profile">{{ session.profile }}</span>
            </button>
          </template>
        </template>
      </div>

      <div class="message-preview">
        <span class="preview-label">{{ t('research.papers.sendToChatPreview') }}</span>
        <pre class="preview-body" dir="auto">{{ messageBody }}</pre>
      </div>

      <footer class="send-modal-footer">
        <NButton size="small" :disabled="sending" @click="close">
          {{ t('research.papers.cancel') }}
        </NButton>
        <NButton
          type="primary"
          size="small"
          data-testid="artifact-send-confirm"
          :loading="sending"
          @click="confirmSend"
        >
          {{ t('research.papers.sendToChatSend') }}
        </NButton>
      </footer>
    </div>
  </NModal>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.artifact-send-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(420px, calc(100vw - 32px));
  max-height: min(560px, calc(100 * var(--vh) - 48px));
  padding: 16px;
  background: var(--bg-main-surface, $bg-card);
  border: 1px solid $border-color;
  border-radius: $radius-md;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}

.send-modal-header {
  h3 {
    margin: 0;
    font-size: 15px;
    color: $text-primary;
  }

  .artifact-name {
    margin: 4px 0 0;
    font-size: 12px;
    color: $text-secondary;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.session-picker {
  flex: 1;
  min-height: 120px;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  padding: 6px;
}

.picker-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  font-size: 13px;
  color: $text-secondary;
}

.picker-empty {
  padding: 8px 0;
}

.session-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  background: transparent;
  text-align: start;
  cursor: pointer;

  &:hover {
    background: $bg-secondary;
  }

  &.active {
    background: $bg-secondary;
    border-color: rgba(var(--accent-primary-rgb), 0.5);
  }
}

.session-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-profile {
  flex-shrink: 0;
  font-size: 11px;
  color: $text-muted;
  font-family: $font-code;
}

.message-preview {
  .preview-label {
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: $text-muted;
  }

  .preview-body {
    max-height: 110px;
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
}

.send-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
