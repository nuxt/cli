import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/versions', () => ({
  getPkgJSON: vi.fn((_cwd: string, pkg: string, options?: { via?: string[] }) => {
    if (pkg === 'vite' && options?.via?.includes('@nuxt/vite-builder')) {
      return { name: 'vite', version: '7.3.1' }
    }
    return null
  }),
  getPkgVersion: vi.fn((_cwd: string, pkg: string, options?: { via?: string[] }) => {
    if (pkg === 'webpack' && options?.via?.includes('@nuxt/webpack-builder')) {
      return '5.99.0'
    }
    if (pkg === '@rspack/core' && options?.via?.includes('@nuxt/rspack-builder')) {
      return '1.3.0'
    }
    return ''
  }),
}))

const { getBuilder } = await import('../../../src/utils/banner')

describe('getBuilder', () => {
  it('resolves vite version via nuxt -> @nuxt/vite-builder', () => {
    expect(getBuilder('/any', 'vite')).toEqual({ name: 'Vite', version: '7.3.1' })
  })

  it('resolves webpack version via @nuxt/webpack-builder', () => {
    expect(getBuilder('/any', 'webpack')).toEqual({ name: 'Webpack', version: '5.99.0' })
  })

  it('resolves rspack version via @nuxt/rspack-builder', () => {
    expect(getBuilder('/any', 'rspack')).toEqual({ name: 'Rspack', version: '1.3.0' })
  })
})
