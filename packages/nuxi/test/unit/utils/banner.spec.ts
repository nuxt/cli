import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/versions', () => ({
  getPkgJSON: vi.fn((_cwd: string, pkg: string, options?: { via?: string }) => {
    if (pkg === 'vite' && options?.via === '@nuxt/vite-builder') {
      return { name: 'vite', version: '7.3.1' }
    }
    return null
  }),
  getPkgVersion: vi.fn(() => ''),
}))

const { getBuilder } = await import('../../../src/utils/banner')

describe('getBuilder', () => {
  it('does not throw when vite package.json cannot be resolved', async () => {
    const { getPkgJSON } = await import('../../../src/utils/versions')
    vi.mocked(getPkgJSON).mockReturnValueOnce(null)
    expect(() => getBuilder('/any', 'vite')).not.toThrow()
  })

  it('resolves vite version via @nuxt/vite-builder', () => {
    expect(getBuilder('/any', 'vite')).toEqual({ name: 'Vite', version: '7.3.1' })
  })
})
