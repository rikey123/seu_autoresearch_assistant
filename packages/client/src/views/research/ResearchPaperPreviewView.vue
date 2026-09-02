<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import PaperPdfPreview from './PaperPdfPreview.vue'
import ResearchPageShell from './ResearchPageShell.vue'
import { usePapersStore } from '@/stores/research/papers'
import { formatFileSize } from '@/utils/research-paper-format'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const store = usePapersStore()

const paperId = computed(() => String(route.params.paperId ?? ''))
const paper = computed(() => store.paperById(paperId.value))
const paperTitle = computed(() => paper.value?.title || paper.value?.original_name || t('research.papers.untitled'))
const paperMeta = computed(() => paper.value
  ? [formatFileSize(paper.value.file_size), paper.value.venue, paper.value.year ? String(paper.value.year) : '']
    .filter(Boolean)
    .join(' · ')
  : '')

function backToList(): void {
  router.push({ name: 'research.papers' })
}

onMounted(() => {
  if (!store.papers.length && !store.loading) {
    void store.refresh()
  }
})
</script>

<template>
  <ResearchPageShell section="papers">
    <template #content>
      <div class="paper-preview-view">
        <div class="preview-toolbar">
          <button type="button" class="preview-back" @click="backToList">
            ‹ {{ t('research.papers.backToList') }}
          </button>
          <div class="preview-heading">
            <p class="preview-title">{{ paperTitle }}</p>
            <p v-if="paperMeta" class="preview-meta">{{ paperMeta }}</p>
          </div>
        </div>
        <p v-if="store.notice" class="preview-notice" role="alert">{{ t(store.notice.key) }}</p>
        <PaperPdfPreview v-if="paperId" :paper-id="paperId" />
      </div>
    </template>
  </ResearchPageShell>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.paper-preview-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 12px;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.preview-back {
  padding: 6px 12px;
  font-size: 13px;
  color: $text-primary;
  white-space: nowrap;
  background: transparent;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  cursor: pointer;
  transition:
    border-color $transition-fast,
    background $transition-fast;

  &:hover {
    border-color: $accent-hover;
    background: $bg-secondary;
  }
}

.preview-heading {
  min-width: 0;
}

.preview-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-meta {
  margin: 2px 0 0;
  font-size: 12px;
  color: $text-secondary;
}

.preview-notice {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
}
</style>
