<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ResearchTabNav from './ResearchTabNav.vue'

const props = defineProps<{
  section: 'workflows' | 'papers' | 'latex' | 'knowledge' | 'artifacts'
}>()

const { t } = useI18n()

const title = computed(() => t(`research.sections.${props.section}.title`))
const subtitle = computed(() => t(`research.sections.${props.section}.subtitle`))
</script>

<template>
  <div class="research-view">
    <header class="research-header">
      <p class="research-eyebrow">{{ t('research.workbench') }}</p>
      <h2 class="research-title">{{ title }}</h2>
      <p class="research-subtitle">{{ subtitle }}</p>
    </header>
    <ResearchTabNav />
    <div class="research-content">
      <slot name="content">
        <section class="research-placeholder">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10 2v6.3L4.6 17.6A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.8-3.4L14 8.3V2" />
          <line x1="8.5" y1="2" x2="15.5" y2="2" />
          <line x1="7.5" y1="14.5" x2="16.5" y2="14.5" />
        </svg>
        <p class="placeholder-title">{{ t('research.placeholderTitle') }}</p>
        <p class="placeholder-text">{{ t('research.placeholderText') }}</p>
      </section>
      </slot>
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

.research-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.research-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 320px;
  padding: 32px;
  border: 1px dashed $border-color;
  border-radius: $radius-md;

  svg {
    color: $text-muted;
    margin-bottom: 6px;
  }
}

.placeholder-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: $text-primary;
}

.placeholder-text {
  margin: 0;
  font-size: 13px;
  color: $text-secondary;
}
</style>
