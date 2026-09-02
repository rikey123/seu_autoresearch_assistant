import { describe, expect, it, vi } from 'vitest'
import { killOwnedProcessTree } from '../../packages/server/src/modules/studio/public/process-tree'

describe('owned process tree cleanup', () => {
  it('uses synchronous Windows tree termination instead of killing only the root', () => {
    const taskkill = vi.fn()
    const fallback = vi.fn()

    killOwnedProcessTree(4321, fallback, { platform: 'win32', taskkill })

    expect(taskkill).toHaveBeenCalledWith(4321)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to the native child kill when Windows tree termination fails', () => {
    const taskkill = vi.fn(() => { throw new Error('taskkill failed') })
    const fallback = vi.fn()

    killOwnedProcessTree(4321, fallback, { platform: 'win32', taskkill })

    expect(fallback).toHaveBeenCalledOnce()
  })

  it.each(['linux', 'darwin', 'freebsd', 'openbsd', 'aix', 'sunos'] as const)(
    'preserves the existing direct-kill signal behavior on %s',
    (platform) => {
      const taskkill = vi.fn()
      const directKill = vi.fn()

      killOwnedProcessTree(4321, directKill, { platform, taskkill })

      expect(taskkill).not.toHaveBeenCalled()
      expect(directKill).toHaveBeenCalledOnce()
    },
  )

  it('falls back to the direct kill when the pid is missing or invalid on Windows', () => {
    for (const pid of [null, undefined, 0, -5, Number.NaN] as const) {
      const taskkill = vi.fn()
      const fallback = vi.fn()

      killOwnedProcessTree(pid, fallback, { platform: 'win32', taskkill })

      expect(taskkill, `pid ${String(pid)} must not reach taskkill`).not.toHaveBeenCalled()
      expect(fallback, `pid ${String(pid)} must use the direct kill`).toHaveBeenCalledOnce()
    }
  })
})
