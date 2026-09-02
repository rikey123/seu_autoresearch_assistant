import { defineStore } from 'pinia'
import { ref } from 'vue'

const RENDER_ENABLED_KEY = 'hermes_vcp_render_enabled_v1'
const AESTHETIC_ENABLED_KEY = 'hermes_vcp_aesthetic_enabled_v1'

// Defaults follow the research workbench design (docs/research-workbench
// DESIGN.md 4.2): card rendering starts off so raw model output can never tear
// the chat layout uninvited, while the aesthetic styling is a pure cosmetic
// layer that is safe to keep on.
export const VCP_RENDER_DEFAULT = false
export const VCP_AESTHETIC_DEFAULT = true

function loadBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) === true
  } catch {
    return fallback
  }
}

function saveBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota/storage errors — fall back to in-memory only
  }
}

// Client-local persisted preferences for the VCP chat card layer
// (html/svg/mermaid/katex fences rendered as sandboxed cards).
export const useVcpPrefsStore = defineStore('vcp-prefs', () => {
  const renderEnabled = ref<boolean>(loadBoolean(RENDER_ENABLED_KEY, VCP_RENDER_DEFAULT))
  const aestheticEnabled = ref<boolean>(loadBoolean(AESTHETIC_ENABLED_KEY, VCP_AESTHETIC_DEFAULT))

  function setRenderEnabled(value: boolean): void {
    renderEnabled.value = value === true
    saveBoolean(RENDER_ENABLED_KEY, renderEnabled.value)
  }

  function setAestheticEnabled(value: boolean): void {
    aestheticEnabled.value = value === true
    saveBoolean(AESTHETIC_ENABLED_KEY, aestheticEnabled.value)
  }

  function toggleRenderEnabled(): boolean {
    setRenderEnabled(!renderEnabled.value)
    return renderEnabled.value
  }

  function toggleAestheticEnabled(): boolean {
    setAestheticEnabled(!aestheticEnabled.value)
    return aestheticEnabled.value
  }

  return {
    renderEnabled,
    aestheticEnabled,
    setRenderEnabled,
    setAestheticEnabled,
    toggleRenderEnabled,
    toggleAestheticEnabled,
  }
})
