import type { Nuxt } from '@nuxt/schema'
import { describe, expect, it, vi } from 'vitest'

import { getServerBuilderName, resolveServerBuild, tryUseNitro } from '../../../src/utils/server-build'

function makeNuxt(options: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return {
    options: { rootDir: '/project', ...options },
    ...extra,
  } as unknown as Nuxt
}

function descriptor(overrides: Record<string, any> = {}) {
  return {
    name: 'nitro',
    capabilities: { server: true, dev: true },
    output: { dir: () => '/project/.output', publicDir: () => '/project/.output/public' },
    ...overrides,
  }
}

const nitroKit = {
  useNitro: () => ({ options: { preset: 'node-server', output: { dir: '/project/.output', publicDir: '/project/.output/public' }, commands: { preview: 'node ./server/index.mjs' } } }),
}

const serverlessKit = {
  useNitro: () => {
    throw new Error('Nitro is not initialized!')
  },
}

describe('tryUseNitro', () => {
  it('should prefer the kit helper when it exists', () => {
    const tryUse = vi.fn(() => undefined)
    expect(tryUseNitro({ ...nitroKit, tryUseNitro: tryUse })).toBeUndefined()
    expect(tryUse).toHaveBeenCalledOnce()
  })

  it('should treat a throwing `useNitro` as no server', () => {
    expect(tryUseNitro(serverlessKit)).toBeUndefined()
  })
})

describe('getServerBuilderName', () => {
  it.each([
    [{ server: { builder: '@nuxt/vite-server' } }, 'vite'],
    [{ server: { builder: 'vite' } }, 'vite'],
    [{ server: { builder: () => {} } }, 'custom'],
    [{}, 'Nitro'],
  ])('should describe %j as %s', (options, expected) => {
    expect(getServerBuilderName(makeNuxt(options))).toBe(expected)
  })

  it('should not claim Nitro when there is no server and no configured builder', () => {
    expect(getServerBuilderName(makeNuxt(), false)).toBe('unknown')
  })

  it('should use the label Nuxt declares', () => {
    const nuxt = makeNuxt({ server: { builder: 'vite' } }, { serverBuild: descriptor({ name: 'vite', label: 'Vite SPA' }) })
    expect(getServerBuilderName(nuxt)).toBe('Vite SPA')
  })
})

describe('resolveServerBuild', () => {
  it('should read output paths from the Nitro instance', () => {
    const build = resolveServerBuild(nitroKit, makeNuxt())

    expect(build).toMatchObject({ name: 'nitro', label: 'Nitro', declared: false, hasServer: true })
    expect(build.target).toBe('node-server')
    expect(build.previewCommand).toBe('node ./server/index.mjs')
    expect(build.dir).toBe('/project/.output')
    expect(build.publicDir).toBe('/project/.output/public')
  })

  it('should prefer the descriptor Nuxt declares, re-reading it on each access', () => {
    let dir = '/project/.vercel/output'
    const nuxt = makeNuxt({}, {
      serverBuild: descriptor({
        name: 'nitro',
        label: 'Nitro',
        targetLabel: 'preset',
        target: () => 'vercel',
        output: { dir: () => dir, publicDir: () => `${dir}/static` },
        preview: { command: () => 'node ./server/index.mjs' },
      }),
    })
    const build = resolveServerBuild(nitroKit, nuxt)

    expect(build).toMatchObject({ name: 'nitro', label: 'Nitro', targetLabel: 'preset', declared: true, hasServer: true, hasDevServer: true })
    expect(build.target).toBe('vercel')
    expect(build.previewCommand).toBe('node ./server/index.mjs')
    expect(build.dir).toBe('/project/.vercel/output')
    dir = '/project/.output'
    expect(build.dir).toBe('/project/.output')
    expect(build.publicDir).toBe('/project/.output/static')
  })

  it('should describe a declared build with no server without consulting Nitro', () => {
    const useNitro = vi.fn(() => {
      throw new Error('Nitro is not initialized!')
    })
    const nuxt = makeNuxt({ server: { builder: 'vite' } }, {
      serverBuild: descriptor({
        name: 'vite',
        label: 'Vite SPA',
        capabilities: { server: false, dev: true },
        output: { dir: () => '/project/.output', publicDir: () => '/project/.output/public' },
        preview: { staticDir: () => '/project/.output/public' },
      }),
    })

    const build = resolveServerBuild({ useNitro }, nuxt)

    expect(build).toMatchObject({ name: 'vite', label: 'Vite SPA', declared: true, hasServer: false, hasDevServer: true })
    expect(build.target).toBeUndefined()
    expect(build.previewCommand).toBeUndefined()
    expect(build.previewStaticDir).toBe('/project/.output/public')
    expect(useNitro).not.toHaveBeenCalled()
  })

  it('should report a builder that declares no dev server', () => {
    const nuxt = makeNuxt({}, { serverBuild: descriptor({ capabilities: { server: true, dev: false } }) })
    expect(resolveServerBuild(nitroKit, nuxt).hasDevServer).toBe(false)
  })

  it('should fall back to defaults when there is no server', () => {
    const build = resolveServerBuild(serverlessKit, makeNuxt({ server: { builder: 'vite' } }))

    expect(build).toMatchObject({ name: 'vite', label: 'vite', declared: false, hasServer: false })
    expect(build.target).toBeUndefined()
    expect(build.dir).toBe('/project/.output')
    expect(build.publicDir).toBe('/project/.output/public')
  })

  it('should honour a configured Nitro output directory without an instance', () => {
    const build = resolveServerBuild(serverlessKit, makeNuxt({ nitro: { output: { dir: 'dist' } } }))

    expect(build.dir).toBe('/project/dist')
  })
})
