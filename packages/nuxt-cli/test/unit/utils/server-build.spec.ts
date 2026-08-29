import type { Nuxt } from '@nuxt/schema'
import { describe, expect, it, vi } from 'vitest'

import { getServerBuilderName, resolveServerBuild, tryUseNitro } from '../../../src/utils/server-build'

function makeNuxt(options: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return {
    options: { rootDir: '/project', ...options },
    ...extra,
  } as unknown as Nuxt
}

const nitroKit = {
  useNitro: () => ({ options: { preset: 'node-server', output: { dir: '/project/.output', publicDir: '/project/.output/public' } } }),
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
    [{}, 'nitro'],
  ])('should describe %j as %s', (options, expected) => {
    expect(getServerBuilderName(makeNuxt(options))).toBe(expected)
  })

  it('should not claim Nitro when there is no server and no configured builder', () => {
    expect(getServerBuilderName(makeNuxt(), false)).toBe('unknown')
  })
})

describe('resolveServerBuild', () => {
  it('should read output paths from the Nitro instance', () => {
    const build = resolveServerBuild(nitroKit, makeNuxt())

    expect(build).toMatchObject({ name: 'nitro', target: 'node-server', hasServer: true })
    expect(build.dir).toBe('/project/.output')
    expect(build.publicDir).toBe('/project/.output/public')
  })

  it('should prefer `nuxt.serverOutput`, re-reading it on each access', () => {
    let dir = '/project/.vercel/output'
    const nuxt = makeNuxt({}, { serverOutput: { dir: () => dir, publicDir: () => `${dir}/static` } })
    const build = resolveServerBuild(nitroKit, nuxt)

    expect(build.dir).toBe('/project/.vercel/output')
    dir = '/project/.output'
    expect(build.dir).toBe('/project/.output')
    expect(build.publicDir).toBe('/project/.output/static')
  })

  it('should fall back to defaults when there is no server', () => {
    const build = resolveServerBuild(serverlessKit, makeNuxt({ server: { builder: 'vite' } }))

    expect(build).toMatchObject({ name: 'vite', target: undefined, hasServer: false })
    expect(build.dir).toBe('/project/.output')
    expect(build.publicDir).toBe('/project/.output/public')
  })

  it('should honour a configured Nitro output directory without an instance', () => {
    const build = resolveServerBuild(serverlessKit, makeNuxt({ nitro: { output: { dir: 'dist' } } }))

    expect(build.dir).toBe('/project/dist')
  })
})
