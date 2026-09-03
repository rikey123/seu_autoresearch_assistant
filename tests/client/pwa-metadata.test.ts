import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('PWA metadata', () => {
  it('links manifest and touch icon from the client shell', () => {
    const html = readFileSync('packages/client/index.html', 'utf8')

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('rel="apple-touch-icon" href="/logo.png"')
    expect(html).toContain('name="apple-mobile-web-app-title" content="SEU科研工作台"')
    expect(html).toContain('<title>SEU科研工作台</title>')
  })

  it('ships a standalone web manifest with the Hermes icon', () => {
    const manifest = JSON.parse(readFileSync('packages/client/public/manifest.webmanifest', 'utf8'))

    expect(manifest.name).toBe('SEU科研工作台')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/#/research/workflows')
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src: '/logo.png',
        type: 'image/png',
        purpose: 'any maskable',
      }),
    ]))
  })
})
