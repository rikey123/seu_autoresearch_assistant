import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const navSource = readFileSync(
  'packages/client/src/components/layout/PageSidebarNav.vue',
  'utf8',
)
const historyViewSource = readFileSync(
  'packages/client/src/views/hermes/HistoryView.vue',
  'utf8',
)

describe('page sidebar conversation switch', () => {
  it('places history after single chat and workflow in the slimmed switch', () => {
    const switchStart = navSource.indexOf('conversation-switch conversation-switch--three')
    const switchSource = navSource.slice(switchStart)

    expect(switchStart).toBeGreaterThan(-1)
    expect(switchSource).not.toContain('openGroupChat')
    expect(switchSource.indexOf('@click="openChat"')).toBeLessThan(switchSource.indexOf('@click="openWorkflow"'))
    expect(switchSource.indexOf('@click="openWorkflow"')).toBeLessThan(switchSource.indexOf('@click="openHistory"'))
    expect(navSource.match(/@click="openHistory"/g)).toHaveLength(1)
  })

  it('leads with the research workbench entry and hides removed entries', () => {
    const tabsStart = navSource.indexOf('class="page-sidebar-tabs"')
    const tabsSource = navSource.slice(tabsStart)

    expect(tabsStart).toBeGreaterThan(-1)
    expect(tabsSource.indexOf('openResearch')).toBeLessThan(tabsSource.indexOf("emit('primary')"))
    expect(navSource).not.toContain('openConnections')
    expect(navSource).not.toContain('openAgentManager')
    expect(navSource).not.toContain('openApiRelay')
    expect(navSource).not.toContain("t('sidebar.groupChat')")
    expect(navSource).toContain("t('sidebar.research')")
    expect(navSource).toContain("t('sidebar.models')")
  })

  it('shows the conversation switch on the history page', () => {
    const historyNav = historyViewSource.match(/<PageSidebarNav[\s\S]*?\/>/)?.[0] || ''

    expect(historyNav).toContain('active="history"')
    expect(historyNav).not.toContain('hide-mode-switch')
  })
})
