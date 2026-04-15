import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/versions', () => ({
  getPkgJSON: vi.fn((_cwd: string, pkg: string, options?: { via?: string }) => {
    // simulate pnpm globalVirtualStore: vite not reachable from cwd or nuxt,
    // only reachable through @nuxt/vite-builder's isolated deps
    if (pkg === 'vite' && options?.via === '@nuxt/vite-builder') {
      return { name: 'vite', version: '7.3.1' }
    }
    return null
  }),
  getPkgVersion: vi.fn(() => ''),
}))

const { getBuilder } = await import('../../../src/utils/banner')

describe('getBuilder', () => {
  // regression for banner crash under pnpm globalVirtualStore
  it('does not throw when vite package.json cannot be resolved anywhere', async () => {
    const { getPkgJSON } = await import('../../../src/utils/versions')
    vi.mocked(getPkgJSON).mockReturnValueOnce(null).mockReturnValueOnce(null)
    expect(() => getBuilder('/any', 'vite')).not.toThrow()
  })

  // proper fix: recover version via @nuxt/vite-builder under strict isolation
  it('resolves vite version via @nuxt/vite-builder when direct lookup fails', () => {
    expect(getBuilder('/any', 'vite')).toEqual({ name: 'Vite', version: '7.3.1' })
  })
})
