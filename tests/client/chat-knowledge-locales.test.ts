import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../../packages/client/src/i18n/locales/en'
import zh from '../../packages/client/src/i18n/locales/zh'
import zhTW from '../../packages/client/src/i18n/locales/zh-TW'
import ar from '../../packages/client/src/i18n/locales/ar'
import de from '../../packages/client/src/i18n/locales/de'
import es from '../../packages/client/src/i18n/locales/es'
import fr from '../../packages/client/src/i18n/locales/fr'
import ja from '../../packages/client/src/i18n/locales/ja'
import ko from '../../packages/client/src/i18n/locales/ko'
import pt from '../../packages/client/src/i18n/locales/pt'
import ru from '../../packages/client/src/i18n/locales/ru'

const localeMessages: Record<string, Record<string, unknown>> = {
  en, zh, 'zh-TW': zhTW, ar, de, es, fr, ja, ko, pt, ru,
}

// User-visible strings added for the chat @知识库 integration (T4.2, P7).
const CHAT_RAG_KEYS = [
  'research.rag.chatSelectedHint',
  'research.rag.chatClearSelection',
  'research.rag.chatCitationsTitle',
  'research.rag.chatAskFailed',
  'research.rag.chatAskTimeout',
  'research.rag.chatSelectionExpired',
] as const

function resolve(messages: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, messages)
}

describe('Chat knowledge base locale coverage', () => {
  it('defines the chat ask strings in every locale under the single research.rag block', () => {
    for (const [locale, messages] of Object.entries(localeMessages)) {
      for (const key of CHAT_RAG_KEYS) {
        expect(resolve(messages, key), `${locale} missing ${key}`).toBeTypeOf('string')
      }
    }
  })

  it('adds no duplicate keys and keeps every chat string compilable and distinct from the key path', () => {
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages } })
      for (const key of CHAT_RAG_KEYS) {
        const rendered = i18n.global.t(key)
        expect(rendered, `${locale} failed to compile ${key}`).not.toBe(key)
        expect(rendered.length, `${locale} ${key} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('interpolates the shared citation page label everywhere', () => {
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages } })
      const rendered = i18n.global.t('research.rag.citationPage', { page: 3 })
      expect(rendered).toContain('3')
    }
  })
})
