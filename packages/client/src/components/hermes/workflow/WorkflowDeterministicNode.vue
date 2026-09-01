<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { NInput } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { WorkflowDeterministicNodeData, WorkflowDeterministicNodeEditableData } from './types'

const props = defineProps<NodeProps<WorkflowDeterministicNodeData>>()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.data.status}`)
const statusLabel = computed(() => t(`workflow.status.${props.data.status}`))
const typeLabel = computed(() => {
  if (props.type === 'script') return t('workflow.nodeType.script')
  if (props.type === 'validate') return t('workflow.nodeType.validate')
  if (props.type === 'render') return t('workflow.nodeType.render')
  return t('workflow.nodeType.unknown')
})
const isScript = computed(() => props.type === 'script')
const isReadonly = computed(() => props.data.readonly === true)

function updateField(key: keyof WorkflowDeterministicNodeEditableData, value: string) {
  props.data.onUpdate?.(props.id, { [key]: value } as Partial<WorkflowDeterministicNodeEditableData>)
}

function handleControlEvent(event: Event) {
  if (!props.data.readonly) event.stopPropagation()
}
</script>

<template>
  <div class="workflow-deterministic-node" :class="[statusClass, { selected }]">
    <Handle id="input" type="source" :position="Position.Left" class="workflow-handle input-handle" />
    <Handle id="top" type="source" :position="Position.Top" class="workflow-handle top-handle" />

    <div class="node-header">
      <span class="node-status-with-tip">
        <span class="node-status-dot" />
        <span class="node-status-label">{{ statusLabel }}</span>
      </span>
      <span v-if="isReadonly" class="node-readonly-badge">{{ t('workflow.node.readonlyBadge') }}</span>
    </div>

    <div
      class="node-body nodrag nopan"
      @click="handleControlEvent"
      @pointerdown="handleControlEvent"
      @pointerup="handleControlEvent"
      @mousedown="handleControlEvent"
      @mouseup="handleControlEvent"
      @touchstart="handleControlEvent"
      @touchend="handleControlEvent"
    >
      <span class="node-type-label">{{ typeLabel }}</span>
      <NInput
        class="node-title-input"
        :value="data.title"
        size="small"
        :disabled="isReadonly"
        :placeholder="t('workflow.node.title')"
        @update:value="value => updateField('title', value)"
      />
      <template v-if="isScript">
        <span class="node-field-label">{{ t('workflow.deterministic.code') }}</span>
        <NInput
          class="node-code-input"
          :value="typeof data.code === 'string' ? data.code : ''"
          type="textarea"
          size="small"
          :resizable="false"
          :disabled="isReadonly"
          :autosize="{ minRows: 4, maxRows: 14 }"
          :input-props="{ spellcheck: false }"
          :placeholder="t('workflow.deterministic.codePlaceholder')"
          @update:value="value => updateField('code', value)"
        />
        <span class="node-field-label">{{ t('workflow.node.input') }}</span>
        <NInput
          class="node-input-input"
          :value="typeof data.input === 'string' ? data.input : ''"
          type="textarea"
          size="small"
          :resizable="false"
          :disabled="isReadonly"
          :autosize="{ minRows: 2, maxRows: 8 }"
          :placeholder="t('workflow.deterministic.inputPlaceholder')"
          @update:value="value => updateField('input', value)"
        />
      </template>
      <p v-else class="node-config-pending">{{ t('workflow.deterministic.configPending') }}</p>
    </div>

    <Handle id="output" type="source" :position="Position.Right" class="workflow-handle output-handle" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="workflow-handle bottom-handle" />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.workflow-deterministic-node {
  width: 100%;
  height: 100%;
  min-width: 240px;
  min-height: 120px;
  border: 1px dashed $border-color;
  border-radius: 8px;
  background: $bg-card;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  color: $text-primary;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color $transition-fast, box-shadow $transition-fast;

  &.selected {
    border-color: var(--accent-info);
    box-shadow: 0 0 0 3px rgba(var(--accent-info-rgb), 0.16), 0 12px 28px rgba(0, 0, 0, 0.12);
  }
}

.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid $border-light;
  font-size: 13px;
  font-weight: 600;
  flex: 0 0 auto;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.node-status-with-tip {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.node-status-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #9ca3af;
}

.status-idle .node-status-dot {
  background: #9ca3af;
}

.status-queued .node-status-dot {
  background: #64748b;
}

.status-running .node-status-dot {
  background: #2563eb;
  box-shadow: 0 0 8px rgba(37, 99, 235, 0.65);
}

.status-pending_approval .node-status-dot {
  background: #d97706;
  box-shadow: 0 0 8px rgba(217, 119, 6, 0.55);
}

.status-approval_rejected .node-status-dot {
  background: #b45309;
}

.status-completed .node-status-dot {
  background: #16a34a;
}

.status-skipped .node-status-dot {
  background: #64748b;
}

.status-failed .node-status-dot {
  background: #dc2626;
}

.status-canceled .node-status-dot {
  background: #f97316;
}

.node-readonly-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid $border-color;
  border-radius: 999px;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 11px;
  font-weight: 500;
}

.node-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.node-type-label {
  width: fit-content;
  padding: 2px 8px;
  border-radius: 4px;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.node-field-label {
  color: $text-secondary;
  font-size: 11px;
  font-weight: 600;
}

.node-code-input {
  :deep(.n-input__textarea-el) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 12px;
    line-height: 1.5;
  }
}

.node-config-pending {
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed $border-color;
  border-radius: 6px;
  background: $bg-secondary;
  color: $text-secondary;
  font-size: 12px;
  line-height: 1.5;
}

.workflow-handle {
  width: 16px;
  height: 16px;
  border: 2px solid $bg-card;
  background: var(--accent-info);
  opacity: 0.36;
  transition: opacity $transition-fast, transform $transition-fast, box-shadow $transition-fast;
}

.workflow-deterministic-node:hover .workflow-handle,
.workflow-deterministic-node.selected .workflow-handle {
  opacity: 1;
  box-shadow: 0 0 0 3px rgba(var(--accent-info-rgb), 0.14);
}

.input-handle {
  left: -9px;
}

.output-handle {
  right: -9px;
}

.top-handle {
  top: -9px;
}

.bottom-handle {
  bottom: -9px;
}
</style>
