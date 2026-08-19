import type { Nuxt } from '@nuxt/schema'

import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '../../utils/terminal'

const VERSIONS: Record<string, string> = {
  'webpack': '5.99.0',
  '@rspack/core': '1.3.0',
  'nuxt': '4.4.6',
  'nitropack': '2.13.4',
  'nitro': '3.0.0',
  'vue': '3.5.39',
}

const CWD_VERSIONS: Record<string, Record<string, string>> = {
  '/no-owner': { nitro: '' },
  '/no-nitro': { nitro: '', nitropack: '' },
  '/no-vue': { vue: '' },
}

const NUXT_WITH_NITROPACK = { name: 'nuxt', version: '4.4.6', dependencies: { nitropack: '^2.13.4' } }
const NUXT_WITH_NITRO_SERVER = { name: 'nuxt', version: '5.0.0', dependencies: { '@nuxt/nitro-server': '^5.0.0' } }
const NITRO_SERVER = { name: '@nuxt/nitro-server', version: '5.0.0', dependencies: { nitro: '^3.0.0' } }

const MANIFESTS: Record<string, Record<string, unknown>> = {
  '/any': { nuxt: NUXT_WITH_NITROPACK },
  '/missing': { nuxt: NUXT_WITH_NITROPACK },
  '/vite-plus': { nuxt: NUXT_WITH_NITROPACK },
  '/nitro-v3': { 'nuxt': NUXT_WITH_NITRO_SERVER, '@nuxt/nitro-server': NITRO_SERVER },
  '/direct-server': { 'nuxt': NUXT_WITH_NITROPACK, '@nuxt/nitro-server': NITRO_SERVER },
  '/no-owner': {},
  '/no-nitro': {},
  '/no-vue': { nuxt: NUXT_WITH_NITROPACK },
}

vi.mock('../../../src/utils/pkg', () => ({
  getPkgJSON: vi.fn((cwd: string, pkg: string, options?: { via?: string[] }) => {
    if (pkg === 'vite' && options?.via?.includes('@nuxt/vite-builder')) {
      if (cwd === '/missing') {
        return null
      }
      if (cwd === '/vite-plus') {
        return { name: '@voidzero-dev/vite-plus-core', version: '0.2.6', bundledVersions: { vite: '8.1.5' } }
      }
      return { name: 'vite', version: '7.3.1' }
    }
    return MANIFESTS[cwd]?.[pkg] ?? null
  }),
  getPkgVersion: vi.fn((cwd: string, pkg: string, options?: { via?: string[] }) => {
    if (pkg === 'webpack' && !options?.via?.includes('@nuxt/webpack-builder')) {
      return ''
    }
    if (pkg === '@rspack/core' && !options?.via?.includes('@nuxt/rspack-builder')) {
      return ''
    }
    return CWD_VERSIONS[cwd]?.[pkg] ?? VERSIONS[pkg] ?? ''
  }),
}))

const { getBuilder, showBanner } = await import('../../../src/utils/banner')

describe('getBuilder', () => {
  it('resolves vite version via nuxt -> @nuxt/vite-builder', () => {
    expect(getBuilder('/any', 'vite')).toEqual({ name: 'Vite', version: '7.3.1' })
  })

  it('reports an unknown vite version when vite is unavailable', () => {
    expect(getBuilder('/missing', 'vite')).toEqual({ name: 'Vite', version: 'unknown', provider: undefined })
  })

  it('resolves the bundled vite version from Vite+', () => {
    expect(getBuilder('/vite-plus', 'vite')).toEqual({
      name: 'Vite',
      version: '8.1.5',
      provider: { name: 'Vite+', version: '0.2.6' },
    })
  })

  it('resolves webpack version via @nuxt/webpack-builder', () => {
    expect(getBuilder('/any', 'webpack')).toEqual({ name: 'Webpack', version: '5.99.0' })
  })

  it('resolves rspack version via @nuxt/rspack-builder', () => {
    expect(getBuilder('/any', 'rspack')).toEqual({ name: 'Rspack', version: '1.3.0' })
  })
})

describe('showBanner', () => {
  it('should print every version on one line', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '4.4.6', options: { rootDir: '/any', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 4.4.6 (with Nitro 2.13.4, Vite 7.3.1 and Vue 3.5.39)"
    `)
  })

  it('should prefer the nitro version declared by nuxt', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '5.0.0', options: { rootDir: '/nitro-v3', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 5.0.0 (with Nitro 3.0.0, Vite 7.3.1 and Vue 3.5.39)"
    `)
  })

  it('should follow nuxt\'s declared nitropack over a directly installed @nuxt/nitro-server', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '4.4.6', options: { rootDir: '/direct-server', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 4.4.6 (with Nitro 2.13.4, Vite 7.3.1 and Vue 3.5.39)"
    `)
  })

  it('should fall back to an installed nitro when no owner declares it', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '4.4.6', options: { rootDir: '/no-owner', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 4.4.6 (with Nitro 2.13.4, Vite 7.3.1 and Vue 3.5.39)"
    `)
  })

  it('should omit nitro when no version can be resolved', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '4.4.6', options: { rootDir: '/no-nitro', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 4.4.6 (with Vite 7.3.1 and Vue 3.5.39)"
    `)
  })

  it('should identify Vite+ as the Vite provider', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '4.4.6', options: { rootDir: '/vite-plus', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 4.4.6 (with Nitro 2.13.4, Vite 8.1.5 via Vite+ 0.2.6 and Vue 3.5.39)"
    `)
  })

  it('should print a single version without a conjunction', async () => {
    const renderer = await render(() =>
      showBanner({ _version: '4.4.6', options: { rootDir: '/no-vue', builder: 'vite' } } as unknown as Nuxt))

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Nuxt 4.4.6 (with Nitro 2.13.4 and Vite 7.3.1)"
    `)
  })
})
