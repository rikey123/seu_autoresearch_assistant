<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  compileLatexDocument,
  createLatexDocument,
  deleteLatexDocument,
  fetchLatestLatexCompilation,
  fetchLatexCompilationPdf,
  fetchLatexDocument,
  fetchLatexEngineInfo,
  listLatexDocuments,
  updateLatexDocument,
  type LatexCompilation,
  type LatexDocument,
  type LatexEngineDiagnostic,
  type LatexEngineInfo,
} from '@/api/studio/latex'
import PdfFilePreview from '@/components/hermes/files/PdfFilePreview.vue'
import ResearchTabNav from './ResearchTabNav.vue'

const NEW_DOCUMENT_SOURCE = [
  '\\documentclass{article}',
  '\\begin{document}',
  '',
  'Hello, tectonic!',
  '',
  '\\end{document}',
  '',
].join('\n')

const POLL_INTERVAL_MS = 1000

const { t } = useI18n()

const documents = ref<LatexDocument[]>([])
const currentId = ref<string | null>(null)
const title = ref('')
const source = ref('')
const dirty = ref(false)
const loadingList = ref(false)
const saving = ref(false)
const savedFlash = ref(false)
const compiling = ref(false)
const compilation = ref<LatexCompilation | null>(null)
const pdfData = ref<ArrayBuffer | null>(null)
const previewFailed = ref(false)
const actionError = ref('')
const engineInfo = ref<LatexEngineInfo | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const activeErrorKey = ref('')

let pollTimer: ReturnType<typeof setTimeout> | null = null
let savedFlashTimer: ReturnType<typeof setTimeout> | null = null

const errors = computed(() => compilation.value?.errors ?? [])

const statusLabel = computed(() => {
  const status = compilation.value?.status
  if (!status) return ''
  return t(`research.latex.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)
})

function stopPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function setActionError(err: unknown): void {
  const error = err as { status?: number; code?: string; message?: string }
  if (error?.status === 503 || error?.code === 'engine_unavailable') {
    actionError.value = t('research.latex.engineUnavailable')
    return
  }
  if (error?.status === 409 || error?.code === 'compilation_in_progress') {
    actionError.value = t('research.latex.compileConflict')
    return
  }
  actionError.value = error?.message || String(err)
}

async function loadPdf(compilationId: string): Promise<void> {
  previewFailed.value = false
  try {
    pdfData.value = await fetchLatexCompilationPdf(compilationId)
  } catch {
    pdfData.value = null
    previewFailed.value = true
  }
}

function applyCompilation(record: LatexCompilation | null): void {
  compilation.value = record
  if (record?.status === 'completed') {
    previewFailed.value = false
    void loadPdf(record.id)
  }
}

async function loadDocument(id: string): Promise<void> {
  stopPolling()
  compiling.value = false
  pdfData.value = null
  previewFailed.value = false
  compilation.value = null
  activeErrorKey.value = ''
  try {
    const doc = await fetchLatexDocument(id)
    currentId.value = doc.id
    title.value = doc.title
    source.value = doc.source
    dirty.value = false
    applyCompilation(await fetchLatestLatexCompilation(id))
  } catch (err) {
    setActionError(err)
  }
}

async function openDocument(doc: LatexDocument): Promise<void> {
  if (doc.id === currentId.value) return
  if (currentId.value && dirty.value) {
    try {
      await save()
    } catch {
      // switching away must not be blocked by a failed autosave
    }
  }
  await loadDocument(doc.id)
}

async function refreshSavedFlag(): Promise<void> {
  savedFlash.value = true
  if (savedFlashTimer !== null) clearTimeout(savedFlashTimer)
  savedFlashTimer = setTimeout(() => {
    savedFlash.value = false
  }, 2000)
}

async function save(): Promise<void> {
  if (!currentId.value) return
  saving.value = true
  try {
    const updated = await updateLatexDocument(currentId.value, {
      title: title.value,
      source: source.value,
    })
    dirty.value = false
    void refreshSavedFlag()
    const index = documents.value.findIndex(doc => doc.id === updated.id)
    if (index >= 0) {
      documents.value[index] = {
        ...documents.value[index],
        title: updated.title,
        updated_at: updated.updated_at,
      }
    }
  } finally {
    saving.value = false
  }
}

async function saveWithError(): Promise<boolean> {
  try {
    await save()
    return true
  } catch (err) {
    setActionError(err)
    return false
  }
}

function schedulePoll(): void {
  stopPolling()
  pollTimer = setTimeout(async () => {
    pollTimer = null
    if (!currentId.value) {
      compiling.value = false
      return
    }
    try {
      const record = await fetchLatestLatexCompilation(currentId.value)
      if (!record || record.document_id !== currentId.value) {
        compiling.value = false
        return
      }
      compilation.value = record
      if (record.status === 'completed') {
        compiling.value = false
        previewFailed.value = false
        await loadPdf(record.id)
        return
      }
      if (record.status === 'failed') {
        compiling.value = false
        return
      }
      schedulePoll()
    } catch {
      compiling.value = false
    }
  }, POLL_INTERVAL_MS)
}

async function compileNow(): Promise<void> {
  if (!currentId.value || compiling.value) return
  actionError.value = ''
  compiling.value = true
  try {
    if (dirty.value) await save()
    const record = await compileLatexDocument(currentId.value)
    compilation.value = record
    if (record.status === 'completed') {
      compiling.value = false
      previewFailed.value = false
      await loadPdf(record.id)
      return
    }
    if (record.status === 'failed') {
      compiling.value = false
      return
    }
    schedulePoll()
  } catch (err) {
    compiling.value = false
    setActionError(err)
  }
}

async function newDocument(): Promise<void> {
  actionError.value = ''
  try {
    const doc = await createLatexDocument({
      title: t('research.latex.untitled'),
      source: NEW_DOCUMENT_SOURCE,
    })
    documents.value = [doc, ...documents.value]
    await loadDocument(doc.id)
  } catch (err) {
    setActionError(err)
  }
}

async function removeDocument(doc: LatexDocument): Promise<void> {
  actionError.value = ''
  try {
    await deleteLatexDocument(doc.id)
  } catch (err) {
    setActionError(err)
    return
  }
  documents.value = documents.value.filter(item => item.id !== doc.id)
  if (currentId.value !== doc.id) return
  stopPolling()
  currentId.value = null
  title.value = ''
  source.value = ''
  dirty.value = false
  compilation.value = null
  pdfData.value = null
  if (documents.value.length) await loadDocument(documents.value[0].id)
}

function errorKey(err: LatexEngineDiagnostic, index: number): string {
  return `${index}|${err.file}|${err.line}|${err.message}`
}

function errorLocation(err: LatexEngineDiagnostic): string {
  const parts: string[] = []
  if (err.file) parts.push(err.file)
  if (err.line != null) parts.push(t('research.latex.lineLabel', { line: err.line }))
  return parts.join(' · ') || '—'
}

// Phase 1 editor is a plain monospace textarea with wrap disabled, so a
// logical line is also a visual line and selecting it doubles as the
// click-to-locate highlight (syntax highlighting arrives in P5).
const EDITOR_LINE_HEIGHT_PX = 21

function focusError(err: LatexEngineDiagnostic): void {
  if (err.line == null) return
  const el = textareaRef.value
  if (!el) return
  const lines = el.value.split('\n')
  const lineIndex = Math.min(Math.max(err.line - 1, 0), Math.max(lines.length - 1, 0))
  let start = 0
  for (let i = 0; i < lineIndex; i++) start += lines[i].length + 1
  const end = start + lines[lineIndex].length
  el.focus()
  el.setSelectionRange(start, end)
  el.scrollTop = Math.max(0, lineIndex * EDITOR_LINE_HEIGHT_PX - el.clientHeight / 2)
}

onMounted(async () => {
  loadingList.value = true
  try {
    documents.value = await listLatexDocuments()
    engineInfo.value = await fetchLatexEngineInfo().catch(() => null)
    if (documents.value.length) await loadDocument(documents.value[0].id)
  } catch (err) {
    actionError.value = t('research.latex.loadFailed')
  } finally {
    loadingList.value = false
  }
})

onBeforeUnmount(() => {
  stopPolling()
  if (savedFlashTimer !== null) clearTimeout(savedFlashTimer)
})
</script>

<template>
  <div class="research-view">
    <header class="research-header">
      <p class="research-eyebrow">{{ t('research.workbench') }}</p>
      <h2 class="research-title">{{ t('research.sections.latex.title') }}</h2>
      <p class="research-subtitle">{{ t('research.sections.latex.subtitle') }}</p>
    </header>
    <ResearchTabNav />
    <div class="latex-workbench">
      <aside class="latex-documents">
        <div class="pane-head">
          <span class="pane-label">{{ t('research.latex.documentsTitle') }}</span>
          <button
            class="ghost-btn"
            type="button"
            @click="newDocument"
          >
            {{ t('research.latex.newDocument') }}
          </button>
        </div>
        <p v-if="loadingList" class="pane-hint">{{ t('research.latex.loading') }}</p>
        <p v-else-if="!documents.length" class="pane-hint">{{ t('research.latex.emptyDocuments') }}</p>
        <ul v-else class="doc-list">
          <li v-for="doc in documents" :key="doc.id">
            <button
              class="doc-item"
              :class="{ active: doc.id === currentId }"
              type="button"
              @click="openDocument(doc)"
            >
              <span class="doc-title">{{ doc.title || t('research.latex.untitled') }}</span>
              <span
                class="doc-delete"
                role="button"
                :aria-label="t('research.latex.deleteDocument')"
                @click.stop="removeDocument(doc)"
              >×</span>
            </button>
          </li>
        </ul>
      </aside>

      <section class="latex-editor">
        <div class="editor-toolbar">
          <input
            v-model="title"
            class="title-input"
            :placeholder="t('research.latex.titlePlaceholder')"
            :disabled="!currentId"
            @input="dirty = true"
          >
          <button
            class="tool-btn"
            type="button"
            :disabled="!currentId || saving"
            @click="saveWithError"
          >
            {{ t('research.latex.save') }}
          </button>
          <button
            class="tool-btn primary"
            type="button"
            :disabled="!currentId || compiling"
            @click="compileNow"
          >
            {{ compiling ? t('research.latex.compiling') : t('research.latex.compile') }}
          </button>
          <span v-if="savedFlash" class="saved-flag">{{ t('research.latex.saved') }}</span>
        </div>
        <p v-if="engineInfo && !engineInfo.available" class="engine-hint">
          {{ t('research.latex.engineUnavailable') }}
        </p>
        <p v-if="actionError" class="action-error">{{ actionError }}</p>
        <textarea
          ref="textareaRef"
          v-model="source"
          class="latex-source"
          wrap="off"
          spellcheck="false"
          :placeholder="t('research.latex.source')"
          :disabled="!currentId"
          @input="dirty = true"
        />
        <section class="error-panel" :class="{ empty: !errors.length }">
          <h3 class="panel-title">{{ t('research.latex.errorPanelTitle') }}</h3>
          <p v-if="compiling" class="pane-hint">{{ t('research.latex.statusRunning') }}</p>
          <p v-else-if="!errors.length" class="pane-hint">{{ t('research.latex.noErrors') }}</p>
          <ul v-else class="error-list">
            <li v-for="(err, index) in errors" :key="errorKey(err, index)">
              <button
                class="error-item"
                :class="{ active: activeErrorKey === errorKey(err, index) }"
                type="button"
                @click="activeErrorKey = errorKey(err, index); focusError(err)"
              >
                <span class="error-loc">{{ errorLocation(err) }}</span>
                <span class="error-message">{{ err.message }}</span>
              </button>
            </li>
          </ul>
        </section>
      </section>

      <section class="latex-preview">
        <div class="pane-head">
          <span class="pane-label">{{ t('research.latex.previewTitle') }}</span>
          <span
            v-if="statusLabel"
            class="status-chip"
            :data-status="compilation?.status"
          >{{ statusLabel }}</span>
        </div>
        <div v-if="pdfData" class="preview-body">
          <PdfFilePreview :data="pdfData" @error="previewFailed = true" />
        </div>
        <div v-else class="preview-empty">
          <template v-if="previewFailed">
            <p>{{ t('research.latex.previewFailed') }}</p>
          </template>
          <template v-else>
            <p>{{ t('research.latex.previewEmpty') }}</p>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.research-view {
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
}

.research-header {
  padding: 20px 24px 0;
}

.research-eyebrow {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: $text-muted;
}

.research-title {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  color: $text-primary;
}

.research-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: $text-secondary;
}

.latex-workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(360px, 1fr) minmax(320px, 1fr);
  gap: 12px;
  padding: 16px 24px 24px;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.pane-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: $text-muted;
}

.pane-hint {
  margin: 0;
  font-size: 13px;
  color: $text-secondary;
}

.ghost-btn {
  border: 1px solid $border-color;
  background: transparent;
  color: $text-secondary;
  border-radius: $radius-sm;
  padding: 3px 8px;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: $text-primary;
    border-color: $accent-muted;
  }
}

.latex-documents {
  min-height: 0;
  overflow-y: auto;
}

.doc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: $radius-sm;
  padding: 6px 8px;
  cursor: pointer;
  text-align: start;

  &:hover {
    background: $bg-secondary;
  }

  &.active {
    background: $bg-secondary;
    border-color: $border-color;

    .doc-title {
      color: $text-primary;
      font-weight: 600;
    }
  }
}

.doc-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: $text-secondary;
}

.doc-delete {
  flex: none;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: $text-muted;
  font-size: 14px;
  line-height: 1;

  &:hover {
    color: $error;
    background: $bg-secondary;
  }
}

.latex-editor {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-input {
  flex: 1;
  min-width: 0;
  border: 1px solid $border-color;
  background: $bg-input;
  color: $text-primary;
  border-radius: $radius-sm;
  padding: 6px 10px;
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: $accent-primary;
  }
}

.tool-btn {
  border: 1px solid $border-color;
  background: $bg-card;
  color: $text-primary;
  border-radius: $radius-sm;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    border-color: $accent-muted;
  }

  &.primary {
    background: $accent-primary;
    border-color: $accent-primary;
    color: var(--text-on-accent);

    &:hover:not(:disabled) {
      background: $accent-hover;
    }
  }
}

.saved-flag {
  font-size: 12px;
  color: $success;
}

.engine-hint {
  margin: 0;
  font-size: 12px;
  color: $warning;
}

.action-error {
  margin: 0;
  font-size: 12px;
  color: $error;
}

.latex-source {
  flex: 1;
  min-height: 200px;
  resize: none;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-input;
  color: $text-primary;
  padding: 10px 12px;
  font-family: $font-code;
  font-size: 13px;
  line-height: 21px;
  white-space: pre;
  overflow: auto;

  &:focus {
    outline: none;
    border-color: $accent-primary;
  }

  &::placeholder {
    color: var(--input-placeholder-color);
  }
}

.error-panel {
  flex: none;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  padding: 8px 10px;

  &.empty {
    border-style: dashed;
  }
}

.panel-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: $text-muted;
}

.error-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-item {
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: baseline;
  text-align: start;
  background: transparent;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  padding: 4px 6px;
  cursor: pointer;

  &:hover,
  &.active {
    background: $bg-secondary;
    border-color: $border-color;
  }
}

.error-loc {
  flex: none;
  font-family: $font-code;
  font-size: 12px;
  color: $error;
}

.error-message {
  font-size: 12px;
  color: $text-secondary;
}

.latex-preview {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.status-chip {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid $border-color;
  color: $text-secondary;

  &[data-status='running'],
  &[data-status='queued'] {
    color: var(--accent-info);
  }

  &[data-status='completed'] {
    color: $success;
  }

  &[data-status='failed'] {
    color: $error;
  }
}

.preview-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  padding: 8px;
}

.preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed $border-color;
  border-radius: $radius-sm;
  padding: 24px;

  p {
    margin: 0;
    font-size: 13px;
    color: $text-secondary;
  }
}
</style>
