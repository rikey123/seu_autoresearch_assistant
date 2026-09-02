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

function collectLeafPaths(value: unknown, prefix: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectLeafPaths(child, `${prefix}.${key}`))
    .sort()
}

describe('Research paper library locale coverage', () => {
  it('defines every research key directly in every locale without fallback', () => {
    const englishPaths = collectLeafPaths(en.research, 'research')
    for (const [locale, messages] of Object.entries(localeMessages)) {
      expect(collectLeafPaths(messages.research, 'research'), `${locale} research keys`).toEqual(englishPaths)
    }
  })

  it('compiles and interpolates every paper library message in every locale', () => {
    const paths = collectLeafPaths(en.research.papers, 'research.papers')
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages } })
      for (const path of paths) {
        expect(() => i18n.global.t(path, { name: 'attention.pdf' }), `${locale} failed to compile ${path}`).not.toThrow()
        expect(i18n.global.t(path, { name: 'attention.pdf' }), `${locale} missing ${path}`).not.toBe(path)
      }
      const confirm = i18n.global.t('research.papers.deleteConfirmText', { name: 'attention.pdf' })
      expect(confirm, `${locale} interpolates deleteConfirmText`).toContain('attention.pdf')
    }
  })
})
