<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const { t } = useI18n()
const route = useRoute()

const tabs = [
  { name: 'research.workflows', label: 'research.sections.workflows.title' },
  { name: 'research.papers', label: 'research.sections.papers.title' },
  { name: 'research.latex', label: 'research.sections.latex.title' },
  { name: 'research.knowledge', label: 'research.sections.knowledge.title' },
  { name: 'research.artifacts', label: 'research.sections.artifacts.title' },
] as const

const activeName = computed(() => String(route.name ?? ''))
</script>

<template>
  <nav class="research-tab-nav" role="tablist" :aria-label="t('research.workbench')">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.name"
      class="research-tab"
      :class="{ active: activeName === tab.name }"
      :to="{ name: tab.name }"
      role="tab"
      :aria-selected="activeName === tab.name"
    >
      {{ t(tab.label) }}
    </RouterLink>
  </nav>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.research-tab-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: 16px;
  padding: 0 24px;
  border-bottom: 1px solid $border-color;
}

.research-tab {
  padding: 8px 14px;
  font-size: 13px;
  line-height: 18px;
  color: $text-secondary;
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition:
    color $transition-fast,
    border-color $transition-fast;

  &:hover {
    color: $text-primary;
  }

  &.active {
    color: $accent-primary;
    border-bottom-color: $accent-primary;
  }
}
</style>
