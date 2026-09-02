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

// The research workbench namespaces added on top of the Studio base. Keys are
// collected from the English catalog so the smoke test follows the live shape
// instead of a frozen literal list.
const WORKBENCH_NAMESPACES = [
  'research.papers',
  'research.latex',
  'research.rag',
  'chat.vcp',
] as const

// workflow.runs.notification* keys are flat siblings rather than a namespace.
const WORKBENCH_EXTRA_KEYS = [
  'workflow.runs.notificationTitle',
  'workflow.runs.notificationCompleted',
  'workflow.runs.notificationFailed',
  'workflow.runs.notificationCanceled',
] as const

// Generic interpolation values: every placeholder used by these namespaces is
// covered (name/count/engine/page/line/type), extra ones are ignored by vue-i18n.
const SAMPLE_PARAMS = {
  name: 'attention.pdf',
  count: 3,
  engine: 'page-qa',
  page: 4,
  line: 12,
  type: 'Mermaid',
  node: 'Script',
}

function collectLeafPaths(value: unknown, prefix: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectLeafPaths(child, `${prefix}.${key}`))
    .sort()
}

function resolve(messages: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, messages)
}

describe('Research workbench runtime locale smoke (11 locales)', () => {
  it('compiles and resolves every workbench key in every locale', () => {
    // Every locale's workbench namespaces expose exactly the English key set.
    for (const [locale, messages] of Object.entries(localeMessages)) {
      for (const namespace of WORKBENCH_NAMESPACES) {
        expect(resolve(messages, namespace), `${locale} missing namespace ${namespace}`).toBeDefined()
      }
      for (const key of WORKBENCH_EXTRA_KEYS) {
        expect(resolve(messages, key), `${locale} missing ${key}`).toBeDefined()
      }
    }

    const expected = [
      ...WORKBENCH_NAMESPACES.flatMap(namespace => collectLeafPaths(resolve(en, namespace), namespace)),
      ...WORKBENCH_EXTRA_KEYS,
    ]
    expect(expected.length).toBeGreaterThan(100)

    for (const [locale, messages] of Object.entries(localeMessages)) {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages } })
      for (const key of expected) {
        const rendered = i18n.global.t(key, SAMPLE_PARAMS)
        expect(rendered, `${locale} failed to compile ${key}`).not.toBe(key)
        expect(rendered.length, `${locale} resolved ${key} to an empty string`).toBeGreaterThan(0)
      }
    }
  })

  it('interpolates the highlighted workbench messages in every locale', () => {
    for (const [locale, messages] of Object.entries(localeMessages)) {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages } })
      const checks: Array<[string, string]> = [
        ['workflow.runs.notificationTitle', 'attention.pdf'],
        ['workflow.runs.notificationCompleted', ''] ,
        ['workflow.runs.notificationFailed', ''],
        ['workflow.runs.notificationCanceled', ''],
        ['research.papers.deleteConfirmText', 'attention.pdf'],
        ['research.rag.paperCount', '3'],
        ['research.rag.chunks', 'page-qa'],
        ['research.rag.citationPage', '4'],
        ['research.latex.lineLabel', '12'],
        ['chat.vcp.frameTitle', 'Mermaid'],
      ]
      for (const [key, needle] of checks) {
        const rendered = i18n.global.t(key, SAMPLE_PARAMS)
        expect(rendered, `${locale} failed to compile ${key}`).not.toBe(key)
        if (needle) expect(rendered, `${locale} did not interpolate ${key}`).toContain(needle)
      }
    }
  })
})
