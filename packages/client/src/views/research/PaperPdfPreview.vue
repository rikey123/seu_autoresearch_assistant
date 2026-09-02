<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { paperFileUrl } from '@/api/studio/research-library'

// Native PDF rendering: the browser (Chromium PDF viewer) loads the document
// from the range-capable streaming endpoint, so large PDFs open progressively
// without downloading the whole file first.
const props = defineProps<{ paperId: string }>()

const { t } = useI18n()

const reloadToken = ref(0)
const frameSrc = computed(() => {
  const base = paperFileUrl(props.paperId)
  if (reloadToken.value === 0) return base
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}reload=${reloadToken.value}`
})

watch(() => props.paperId, () => {
  reloadToken.value = 0
})

function reload(): void {
  reloadToken.value += 1
}
</script>

<template>
  <div class="paper-pdf-preview">
    <iframe
      :key="frameSrc"
      :src="frameSrc"
      class="pdf-frame"
      :title="t('research.papers.previewFrame')"
      :aria-label="t('research.papers.previewFrame')"
    />
    <button type="button" class="pdf-reload" @click="reload">
      {{ t('research.papers.reload') }}
    </button>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.paper-pdf-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.pdf-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  background: #ffffff;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.pdf-reload {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  padding: 4px 10px;
  font-size: 12px;
  color: $text-secondary;
  background: var(--bg-card);
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  cursor: pointer;

  &:hover {
    color: $text-primary;
    border-color: $accent-hover;
  }
}
</style>
