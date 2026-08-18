import type { PackageJson } from 'pkg-types'

import { describe, expect, it } from 'vitest'

import { findNitroPkgName, resolveNuxtNitroDependency } from '../../../src/utils/nitro'

describe('findNitroPkgName', () => {
  it('should read the declared nitro dependency', () => {
    expect(findNitroPkgName({ dependencies: { nitro: '^3.0.0' } })).toBe('nitro')
    expect(findNitroPkgName({ dependencies: { nitropack: '^2.13.0' } })).toBe('nitropack')
  })

  it('should read an aliased nightly dependency under its declared name', () => {
    expect(findNitroPkgName({ dependencies: { nitro: 'npm:nitro-nightly@latest' } })).toBe('nitro')
    expect(findNitroPkgName({ dependencies: { nitropack: 'npm:nitropack-nightly@2.0.0' } })).toBe('nitropack')
  })

  it('should prefer the current name when several are declared', () => {
    expect(findNitroPkgName({ dependencies: { nitro: '^3.0.0', nitropack: '^2.13.0' } })).toBe('nitro')
  })

  it('should read a dependency declared without a range', () => {
    expect(findNitroPkgName({ dependencies: { nitro: '' } })).toBe('nitro')
  })

  it('should return undefined for a manifest without a nitro dependency', () => {
    expect(findNitroPkgName({ dependencies: { vue: '^3.5.0' } })).toBeUndefined()
    expect(findNitroPkgName({ dependencies: { 'nitro-nightly': 'latest' } })).toBeUndefined()
    expect(findNitroPkgName({})).toBeUndefined()
    expect(findNitroPkgName(null)).toBeUndefined()
  })
})

describe('resolveNuxtNitroDependency', () => {
  const reader = (manifests: Record<string, PackageJson>) =>
    (name: string) => manifests[name] ?? null

  it('should resolve nitro declared by nuxt directly', () => {
    const read = reader({ nuxt: { dependencies: { nitropack: '^2.13.4' } } })

    expect(resolveNuxtNitroDependency(read)).toEqual({ name: 'nitropack', via: ['nuxt'] })
  })

  it('should follow nuxt\'s declared @nuxt/nitro-server', () => {
    const read = reader({
      'nuxt': { dependencies: { '@nuxt/nitro-server': '^5.0.0' } },
      '@nuxt/nitro-server': { dependencies: { nitro: '^3.0.0' } },
    })

    expect(resolveNuxtNitroDependency(read)).toEqual({ name: 'nitro', via: ['nuxt', '@nuxt/nitro-server'] })
  })

  it('should ignore @nuxt/nitro-server when nuxt does not declare it', () => {
    const read = reader({
      'nuxt': { dependencies: { nitropack: '^2.13.4' } },
      '@nuxt/nitro-server': { dependencies: { nitro: '^3.0.0' } },
    })

    expect(resolveNuxtNitroDependency(read)).toEqual({ name: 'nitropack', via: ['nuxt'] })
  })

  it('should resolve nitro declared by nuxt-nightly', () => {
    const read = reader({ 'nuxt-nightly': { dependencies: { nitropack: '^2.13.4' } } })

    expect(resolveNuxtNitroDependency(read)).toEqual({ name: 'nitropack', via: ['nuxt-nightly'] })
  })

  it('should return undefined when no manifest is readable', () => {
    expect(resolveNuxtNitroDependency(() => null)).toBeUndefined()
    expect(resolveNuxtNitroDependency(reader({ nuxt: { dependencies: { vue: '^3.5.0' } } }))).toBeUndefined()
  })
})
