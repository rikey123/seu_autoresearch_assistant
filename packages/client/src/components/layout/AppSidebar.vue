<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { NButton, NModal, useMessage, NTag } from "naive-ui";
import { useAppStore } from "@/stores/hermes/app";
import RouteLinkItem from "@/components/common/RouteLinkItem.vue";
import ModelSelector from "@/components/layout/ModelSelector.vue";
import ProfileSelector from "@/components/layout/ProfileSelector.vue";
import LanguageSwitch from "@/components/layout/LanguageSwitch.vue";
import ThemeSwitch from "@/components/layout/ThemeSwitch.vue";
import { changelog } from "@/data/changelog";
import {
  getStoredUserId,
  getStoredUsername,
} from "@/api/client";
import { clearThemeBackgroundCache } from "@/api/studio/theme";

const { t } = useI18n();
const message = useMessage();
const route = useRoute();
const appStore = useAppStore();
const selectedKey = computed(() => {
  return route.name as string;
});
const isResearchActive = computed(
  () => typeof route.name === "string" && route.name.startsWith("research."),
);
const currentUsername = computed(() => getStoredUsername());
const showChangelog = ref(false);
const showDockerUpdateTip = ref(false);
const isDockerRuntime = computed(() => appStore.isDocker);

function handleSidebarClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;

  if (!target?.closest(".route-link-item")) {
    return;
  }

  if (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches
  ) {
    appStore.closeSidebar();
  }
}

async function handleUpdate() {
  const ok = await appStore.doUpdate();
  if (ok) {
    message.success(t("sidebar.updateSuccess"), { duration: 5000 });
  } else {
    message.error(t("sidebar.updateFailed"));
  }
}

function handleReloadClient() {
  appStore.reloadClient();
}

async function handleLogout() {
  const userId = getStoredUserId();
  if (userId) await clearThemeBackgroundCache(userId);
  localStorage.clear();
  window.location.reload();
}

function openChangelog() {
  showChangelog.value = true;
}

function handleDockerUpdateTip() {
  showDockerUpdateTip.value = true;
}

function handleUpdateClick() {
  if (isDockerRuntime.value) {
    handleDockerUpdateTip();
    return;
  }
  void handleUpdate();
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{
      open: appStore.sidebarOpen,
      collapsed: appStore.sidebarCollapsed,
    }"
    @click="handleSidebarClick"
  >
    <nav class="sidebar-nav">
      <RouteLinkItem
        class="nav-item research-entry"
        :to="{ name: 'research.workflows' }"
        :active="isResearchActive"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M9 3h6" />
          <path d="M10 3v5.2L4.6 17.6A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.8-3.4L14 8.2V3" />
          <line x1="7.5" y1="14.5" x2="16.5" y2="14.5" />
        </svg>
        <span>{{ t("sidebar.research") }}</span>
      </RouteLinkItem>
      <RouteLinkItem
        class="nav-item"
        :to="{ name: 'hermes.chat' }"
        :active="selectedKey === 'hermes.chat' || selectedKey === 'hermes.session'"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>{{ t("sidebar.chat") }}</span>
      </RouteLinkItem>
      <RouteLinkItem
        class="nav-item"
        :to="{ name: 'hermes.workflow' }"
        :active="selectedKey === 'hermes.workflow'"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="5" cy="12" r="3" />
          <circle cx="19" cy="6" r="3" />
          <circle cx="19" cy="18" r="3" />
          <path d="M8 12h3a4 4 0 0 0 4-4V6" />
          <path d="M8 12h3a4 4 0 0 1 4 4v2" />
        </svg>
        <span>{{ t("sidebar.workflow") }}</span>
      </RouteLinkItem>
      <RouteLinkItem
        class="nav-item"
        :to="{ name: 'hermes.history' }"
        :active="selectedKey === 'hermes.history' || selectedKey === 'hermes.historySession'"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>{{ t("sidebar.history") }}</span>
      </RouteLinkItem>
      <RouteLinkItem
        class="nav-item"
        :to="{ name: 'hermes.models' }"
        :active="selectedKey === 'hermes.models'"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
        <span>{{ t("sidebar.models") }}</span>
      </RouteLinkItem>
      <RouteLinkItem
        class="nav-item"
        :to="{ name: 'hermes.settings' }"
        :active="selectedKey === 'hermes.settings'"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
        <span>{{ t("sidebar.settings") }}</span>
      </RouteLinkItem>
    </nav>

    <ProfileSelector />
    <ModelSelector />

    <div class="sidebar-footer">
      <button class="nav-item logout-item" @click="handleLogout">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>{{ t("sidebar.logout") }}</span>
        <span
          v-if="currentUsername"
          class="logout-username"
          :title="currentUsername"
          >{{ currentUsername }}</span
        >
      </button>
      <div class="status-row">
        <div
          class="status-indicator"
          :class="{
            connected: appStore.connected,
            disconnected: !appStore.connected,
          }"
        >
          <span class="status-dot"></span>
          <span class="status-text">{{
            appStore.connected
              ? t("sidebar.connected")
              : t("sidebar.disconnected")
          }}</span>
        </div>
        <LanguageSwitch />
      </div>
      <div class="version-info">
        <span
          class="version-text"
          role="button"
          tabindex="0"
          :title="`${t('app.name')} v${appStore.serverVersion || '0.1.0'}`"
          @click="openChangelog"
          @keydown.enter="openChangelog"
          @keydown.space.prevent="openChangelog"
        >
          {{ t("app.name") }} v{{ appStore.serverVersion || "0.1.0" }}
        </span>
        <ThemeSwitch />
      </div>
      <NButton
        v-if="appStore.clientOutdated"
        type="warning"
        size="tiny"
        block
        class="update-btn"
        @click="handleReloadClient"
      >
        {{
          t("sidebar.reloadClientVersion", { version: appStore.serverVersion })
        }}
      </NButton>
      <NButton
        v-else-if="appStore.updateAvailable"
        type="primary"
        size="tiny"
        block
        class="update-btn"
        :loading="!isDockerRuntime && appStore.updating"
        @click="handleUpdateClick"
      >
        {{
          !isDockerRuntime && appStore.updating
            ? t("sidebar.updating")
            : t("sidebar.updateVersion", { version: appStore.latestVersion })
        }}
      </NButton>
    </div>

    <div class="sidebar-top-actions">
      <button
        class="collapse-btn"
        @click="appStore.toggleSidebarCollapsed()"
        :title="
          appStore.sidebarCollapsed
            ? t('sidebar.expand')
            : t('sidebar.collapse')
        "
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline v-if="appStore.sidebarCollapsed" points="9 18 15 12 9 6" />
          <polyline v-else points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>

    <NModal
      v-model:show="showChangelog"
      preset="dialog"
      :title="t('sidebar.changelog')"
      style="width: 520px"
    >
      <div class="changelog-list">
        <div
          v-for="entry in changelog"
          :key="entry.version"
          class="changelog-version-block"
        >
          <div class="changelog-version-header">
            <span class="changelog-version-tag">v{{ entry.version }}</span>
            <span class="changelog-date">{{ entry.date }}</span>
          </div>
          <ul class="changelog-changes">
            <li v-for="(change, idx) in entry.changes" :key="idx">
              {{ t(change) }}
            </li>
          </ul>
        </div>
      </div>
    </NModal>
    <NModal
      v-model:show="showDockerUpdateTip"
      preset="dialog"
      :title="t('sidebar.dockerUpdateTitle')"
      style="width: 480px"
    >
      <div class="docker-update-modal">
        <p>{{ t("sidebar.dockerUpdateGuide") }}</p>
        <div class="docker-update-commands">
          <code class="docker-command">docker compose pull</code>
          <code class="docker-command"
            >docker compose up -d --force-recreate</code
          >
        </div>
        <p class="docker-update-note">
          <NTag size="small" type="info" :bordered="false">{{
            t("sidebar.dockerUpdateNote")
          }}</NTag>
        </p>
      </div>
    </NModal>
  </aside>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.sidebar {
  position: relative;
  width: $sidebar-width;
  height: auto;
  min-height: 0;
  align-self: stretch;
  margin: 10px;
  background-color: $bg-sidebar-surface;
  border: 1px solid $border-color;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  padding: 8px 12px 20px;
  overflow: hidden;
  flex-shrink: 0;
  transition: width $transition-normal;
}

.sidebar-nav {
  flex: 1;
  display: flex;
  padding-top: 8px;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: none;
  background: none;
  appearance: none;
  text-decoration: none;
  color: $text-secondary;
  font-size: 14px;
  border-radius: $radius-sm;
  cursor: pointer;
  transition: all $transition-fast;
  width: 100%;
  text-align: start;

  &:hover {
    background-color: rgba(var(--accent-primary-rgb), 0.06);
    color: $text-primary;
  }

  &.active {
    background-color: rgba(var(--accent-primary-rgb), 0.12);
    color: $accent-primary;
  }

  .beta-tag {
    font-size: 10px;
    color: $text-muted;
    margin-inline-start: 2px;
  }
}

// Product entry point: keep the research workbench visually prominent at the
// top of the navigation.
.research-entry {
  font-weight: 600;

  svg {
    color: $accent-primary;
  }
}

.sidebar-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid $border-color;
}

.sidebar-footer {
  padding-top: 10px;
  border-top: 1px solid $border-color;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.logout-item {
  color: $text-secondary;

  &:hover {
    color: $error;
  }

  > span:not(.logout-username) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.logout-username {
  margin-inline-start: auto;
  max-width: 96px;
  color: $text-muted;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0 4px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-inline-start: 12px;
  font-size: 12px;
  color: $text-secondary;

  &.connected .status-dot {
    background-color: $success;
    box-shadow: 0 0 6px rgba(var(--success-rgb), 0.5);
  }

  &.disconnected .status-dot {
    background-color: $error;
  }
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-info {
  padding: 2px 0 8px 12px;
  font-size: 11px;
  color: $text-muted;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  overflow: hidden;
}

.version-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: start;
  cursor: pointer;
  transition: color $transition-fast;

  &:hover {
    color: $accent-primary;
  }
}

.version-info :deep(.theme-switch-container) {
  flex-shrink: 0;
}

.update-btn {
  margin: 4px 0 0;
  border-radius: $radius-sm;
}

.changelog-list {
  max-height: min(70vh, 640px);
  overflow-y: auto;
}

.changelog-version-block {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }
}

.changelog-version-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.changelog-version-tag {
  font-weight: 600;
  font-size: 14px;
  color: $text-primary;
  font-family: $font-code;
}

.changelog-date {
  font-size: 12px;
  color: $text-muted;
}

.changelog-changes {
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    font-size: 13px;
    color: $text-secondary;
    padding: 4px 0 4px 16px;
    position: relative;

    &::before {
      content: "";
      position: absolute;
      left: 0;
      top: 12px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: $text-muted;
    }
  }
}

// ─── Collapsed sidebar (icon-rail mode) ─────────────────────────

.sidebar.collapsed {
  width: $sidebar-collapsed-width;
  padding: 8px 8px 12px;
  overflow: hidden;

  .collapse-btn {
    display: flex;
    margin: 0;
  }

  .sidebar-top-actions {
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
  }

  .nav-item {
    justify-content: center;
    padding: 10px 4px;
    gap: 0;

    span {
      display: none;
    }

    svg {
      flex-shrink: 0;
    }
  }

  :deep(.model-selector) {
    display: none;
  }

  :deep(.profile-selector) {
    display: flex;
    justify-content: center;
    padding: 8px 0;
  }

  :deep(.profile-selector .selector-label),
  :deep(.profile-selector .profile-name) {
    display: none;
  }

  :deep(.profile-selector .profile-display) {
    width: 40px;
    justify-content: center;
    padding: 4px;
  }

  .sidebar-footer {
    align-items: center;
    gap: 6px;
    padding-top: 8px;
  }

  .status-row,
  .version-info,
  .update-btn {
    display: none;
  }
}

// ─── Collapse button ────────────────────────────────────────────

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  appearance: none;
  text-decoration: none;
  color: $text-muted;
  border-radius: $radius-sm;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0;
  transition: all $transition-fast;

  &:hover {
    color: $text-primary;
    background-color: rgba(var(--accent-primary-rgb), 0.08);
  }
}

@media (max-width: $breakpoint-mobile) {
  .sidebar {
    position: fixed;
    left: 10px;
    top: 10px;
    bottom: 10px;
    margin: 0;
    height: auto;
    z-index: 1000;
    transform: translateX(calc(-100% - 10px));
    transition: transform $transition-normal;
    padding-top: env(safe-area-inset-top, 0px);

    &.open {
      transform: translateX(0);
    }

    .collapse-btn {
      display: flex;
    }

    // Override global utility — sidebar is always 240px wide
    .input-sm {
      width: 90px;
    }
  }
}

.docker-update-modal {
  p {
    margin: 12px 0;
    font-size: 14px;
    line-height: 1.6;
    color: $text-secondary;
  }

  .docker-update-commands {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 16px 0;
  }

  .docker-command {
    display: block;
    padding: 10px 14px;
    background: $code-bg;
    border-radius: $radius-sm;
    font-family: $font-code;
    font-size: 13px;
    color: $text-primary;
    user-select: all;
    cursor: text;
    border: 1px solid $border-color;
  }

  .docker-update-note {
    margin-top: 16px;
  }
}
</style>
