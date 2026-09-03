<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NInput, NModal, NPopconfirm, NSpin, useMessage } from 'naive-ui'
import ResearchPageShell from './ResearchPageShell.vue'
import { useWorkflowHubStore } from '@/stores/research/workflow-hub'
import type { ResearchWorkflowTemplateSummary } from '@/api/studio/research-workflow-templates'
import type { WorkflowRecord } from '@/api/studio/workflows'
import { suggestWorkflowName } from '@/utils/research-workflow-template-mapping'
import { formatTimestamp } from '@/utils/research-paper-format'

const router = useRouter()
const { t } = useI18n()
const toast = useMessage()
const store = useWorkflowHubStore()

// Create-from-template naming dialog: the name is the only user input; the
// node/edge definition maps 1:1 onto the createWorkflow payload.
const createModalOpen = ref(false)
const createTargetTemplate = ref<ResearchWorkflowTemplateSummary | null>(null)
const createName = ref('')

const createConfirmDisabled = computed(() => !createName.value.trim())

function nodeCountLabel(count: number): string {
  return t('research.workflows.nodeCount', { count })
}

function openCreateModal(template: ResearchWorkflowTemplateSummary): void {
  createTargetTemplate.value = template
  createName.value = suggestWorkflowName(template)
  createModalOpen.value = true
}

function cancelCreate(): void {
  createModalOpen.value = false
}

async function confirmCreate(): Promise<void> {
  const template = createTargetTemplate.value
  if (!template || store.creating) return
  const workflow = await store.createFromTemplate(template.id, createName.value)
  if (!workflow) return
  createModalOpen.value = false
  toast.success(t('research.workflows.createSuccess'))
  // Straight into the canvas: the full editor lives on the Hermes base page.
  void router.push({ name: 'hermes.workflow', query: { workflowId: workflow.id } })
}

function flowName(workflow: WorkflowRecord): string {
  return workflow.name || t('research.workflows.untitledFlow')
}

function openCanvas(workflow: WorkflowRecord): void {
  void router.push({ name: 'hermes.workflow', query: { workflowId: workflow.id } })
}

async function onConfirmDelete(workflow: WorkflowRecord): Promise<void> {
  await store.removeWorkflow(workflow.id)
}

onMounted(() => {
  void store.refreshTemplates()
  void store.refreshWorkflows()
})
</script>

<template>
  <ResearchPageShell section="workflows">
    <template #content>
      <div class="workflows-hub">
        <p v-if="store.notice" class="hub-notice" role="alert">{{ t(store.notice.key) }}</p>

        <section class="hub-section" data-testid="template-gallery">
          <h3 class="hub-section-title">{{ t('research.workflows.templatesTitle') }}</h3>
          <div v-if="store.templatesLoading" class="hub-state">
            <NSpin size="small" />
            <span>{{ t('research.workflows.templatesLoading') }}</span>
          </div>
          <div v-else-if="store.templatesLoadFailed" class="hub-state">
            <span>{{ t('research.workflows.templatesLoadFailed') }}</span>
            <NButton size="small" @click="store.refreshTemplates()">
              {{ t('research.workflows.retry') }}
            </NButton>
          </div>
          <div v-else class="template-grid">
            <article v-for="template in store.templates" :key="template.id" class="template-card">
              <button type="button" class="template-main" @click="openCreateModal(template)">
                <span class="template-name">{{ template.name }}</span>
                <span class="template-desc">{{ template.description }}</span>
              </button>
              <div class="template-footer">
                <span class="template-meta">{{ nodeCountLabel(template.nodeCount) }}</span>
                <NButton
                  type="primary"
                  size="tiny"
                  data-testid="use-template"
                  :aria-label="`${t('research.workflows.useTemplate')} ${template.name}`"
                  @click="openCreateModal(template)"
                >
                  {{ t('research.workflows.useTemplate') }}
                </NButton>
              </div>
            </article>
          </div>
        </section>

        <section class="hub-section" data-testid="flow-list">
          <h3 class="hub-section-title">{{ t('research.workflows.myWorkflowsTitle') }}</h3>
          <div v-if="store.workflowsLoading" class="hub-state">
            <NSpin size="small" />
            <span>{{ t('research.workflows.flowsLoading') }}</span>
          </div>
          <div v-else-if="store.workflowsLoadFailed" class="hub-state">
            <span>{{ t('research.workflows.flowsLoadFailed') }}</span>
            <NButton size="small" @click="store.refreshWorkflows()">
              {{ t('research.workflows.retry') }}
            </NButton>
          </div>
          <div v-else-if="!store.hasWorkflows" class="flows-empty">
            <NEmpty :description="t('research.workflows.flowsEmpty')" />
            <p class="flows-empty-hint">{{ t('research.workflows.flowsEmptyHint') }}</p>
          </div>
          <ul v-else class="flow-collection">
            <li v-for="workflow in store.workflows" :key="workflow.id" class="flow-item">
              <button type="button" class="flow-main" @click="openCanvas(workflow)">
                <span class="flow-name">{{ flowName(workflow) }}</span>
              </button>
              <span class="flow-meta">{{ nodeCountLabel(workflow.nodes.length) }}</span>
              <span class="flow-time">{{ formatTimestamp(workflow.updated_at) }}</span>
              <NButton
                size="tiny"
                quaternary
                class="flow-open"
                data-testid="flow-open"
                :aria-label="`${t('research.workflows.open')} ${flowName(workflow)}`"
                @click.stop="openCanvas(workflow)"
              >
                {{ t('research.workflows.open') }}
              </NButton>
              <NPopconfirm
                :show-icon="false"
                :positive-text="t('research.workflows.deleteConfirm')"
                :negative-text="t('research.workflows.cancel')"
                @positive-click="onConfirmDelete(workflow)"
              >
                <template #trigger>
                  <NButton
                    size="tiny"
                    quaternary
                    class="flow-delete"
                    data-testid="flow-delete"
                    :loading="store.deletingIds.includes(workflow.id)"
                    :aria-label="`${t('research.workflows.delete')} ${flowName(workflow)}`"
                  >
                    {{ t('research.workflows.delete') }}
                  </NButton>
                </template>
                {{ t('research.workflows.deleteConfirmText', { name: flowName(workflow) }) }}
              </NPopconfirm>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </ResearchPageShell>

  <NModal
    :show="createModalOpen"
    :mask-closable="!store.creating"
    @update:show="value => { if (!value) cancelCreate() }"
  >
    <div class="create-modal" role="dialog" :aria-label="t('research.workflows.createModalTitle')">
      <header class="create-modal-header">
        <h3>{{ t('research.workflows.createModalTitle') }}</h3>
        <p v-if="createTargetTemplate" class="create-modal-template">{{ createTargetTemplate.name }}</p>
      </header>
      <div class="create-modal-body">
        <span class="create-name-label">{{ t('research.workflows.createNameLabel') }}</span>
        <NInput
          v-model:value="createName"
          size="small"
          data-testid="workflow-name-input"
          :placeholder="t('research.workflows.createNamePlaceholder')"
          :aria-label="t('research.workflows.createNameLabel')"
          :disabled="store.creating"
          @keydown.enter="confirmCreate"
        />
      </div>
      <footer class="create-modal-footer">
        <NButton size="small" :disabled="store.creating" @click="cancelCreate">
          {{ t('research.workflows.cancel') }}
        </NButton>
        <NButton
          type="primary"
          size="small"
          data-testid="create-confirm"
          :loading="store.creating"
          :disabled="createConfirmDisabled"
          @click="confirmCreate"
        >
          {{ t('research.workflows.createConfirm') }}
        </NButton>
      </footer>
    </div>
  </NModal>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.workflows-hub {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hub-notice {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: $text-primary;
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
}

.hub-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hub-section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
}

.hub-state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px;
  font-size: 13px;
  color: $text-secondary;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.template-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  transition: border-color $transition-fast;

  &:hover {
    border-color: $accent-muted;
  }
}

.template-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 0;
  background: transparent;
  border: none;
  text-align: start;
  cursor: pointer;
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
}

.template-desc {
  font-size: 12px;
  line-height: 1.5;
  color: $text-secondary;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}

.template-meta {
  font-size: 12px;
  color: $text-muted;
  font-variant-numeric: tabular-nums;
}

.flows-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 24px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}

.flows-empty-hint {
  margin: 0;
  font-size: 13px;
  color: $text-secondary;
}

.flow-collection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.flow-item {
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

.flow-main {
  display: flex;
  flex: 1;
  min-width: 0;
  padding: 4px 8px 4px 0;
  background: transparent;
  border: none;
  text-align: start;
  cursor: pointer;
}

.flow-name {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-meta,
.flow-time {
  flex-shrink: 0;
  font-size: 12px;
  color: $text-secondary;
  font-variant-numeric: tabular-nums;
}

.flow-open,
.flow-delete {
  flex-shrink: 0;
}

.create-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(380px, calc(100vw - 32px));
  padding: 16px;
  background: var(--bg-main-surface, $bg-card);
  border: 1px solid $border-color;
  border-radius: $radius-md;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}

.create-modal-header {
  h3 {
    margin: 0;
    font-size: 15px;
    color: $text-primary;
  }

  .create-modal-template {
    margin: 4px 0 0;
    font-size: 12px;
    color: $text-secondary;
  }
}

.create-modal-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.create-name-label {
  font-size: 12px;
  font-weight: 600;
  color: $text-secondary;
}

.create-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
