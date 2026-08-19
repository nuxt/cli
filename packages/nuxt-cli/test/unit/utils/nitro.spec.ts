import type { PackageJson } from 'pkg-types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findNitroPkgName, getNitroVersion, resolveNitroVersion, resolveNuxtNitroDependency } from '../../../src/utils/nitro'
import { getPkgJSON, getPkgVersion } from '../../../src/utils/pkg'

vi.mock('../../../src/utils/pkg', () => ({
  getPkgJSON: vi.fn(),
  getPkgVersion: vi.fn(),
}))

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

describe('getNitroVersion', () => {
  beforeEach(() => {
    vi.mocked(getPkgJSON).mockReset()
    vi.mocked(getPkgVersion).mockReset()
  })

  it('should resolve the version through the nuxt dependency chain', () => {
    vi.mocked(getPkgJSON).mockImplementation((_cwd, pkg) => ({
      'nuxt': { dependencies: { '@nuxt/nitro-server': '^4.5.2' } },
      '@nuxt/nitro-server': { dependencies: { nitropack: '^2.13.4' } },
    }[pkg] ?? null))
    vi.mocked(getPkgVersion).mockReturnValue('2.13.4')

    expect(getNitroVersion('/project')).toBe('2.13.4')
    expect(getPkgVersion).toHaveBeenCalledWith('/project', 'nitropack', { via: ['nuxt', '@nuxt/nitro-server'], strict: true })
  })

  it('should fall back to a directly resolvable nitro package', () => {
    vi.mocked(getPkgJSON).mockReturnValue(null)
    vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg) => pkg === 'nitropack' ? '2.13.4' : '')

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should fall back when the declared package cannot be resolved', () => {
    vi.mocked(getPkgJSON).mockImplementation((_cwd, pkg) => pkg === 'nuxt' ? { dependencies: { nitro: '^3.0.0' } } : null)
    vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg, options) => pkg === 'nitropack' && !options?.via ? '2.13.4' : '')

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should return an empty string when nitro is not installed', () => {
    vi.mocked(getPkgJSON).mockReturnValue(null)
    vi.mocked(getPkgVersion).mockReturnValue('')

    expect(getNitroVersion('/project')).toBe('')
  })
})

describe('resolveNitroVersion', () => {
  beforeEach(() => {
    vi.mocked(getPkgJSON).mockReset()
    vi.mocked(getPkgVersion).mockReset()
  })

  it('should prefer the installed version', async () => {
    vi.mocked(getPkgJSON).mockReturnValue(null)
    vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg) => pkg === 'nitropack' ? '2.13.4' : '')

    await expect(resolveNitroVersion('/project', async () => '2.0.0')).resolves.toBe('2.13.4')
  })

  it('should prefer the declared version of the package nuxt depends on', async () => {
    vi.mocked(getPkgJSON).mockImplementation((_cwd, pkg) => pkg === 'nuxt' ? { dependencies: { nitropack: '^2.13.4' } } : null)
    vi.mocked(getPkgVersion).mockReturnValue('')

    await expect(resolveNitroVersion('/project', async name => ({ nitro: '^3.0.0', nitropack: '^2.13.4' }[name]))).resolves.toBe('^2.13.4')
  })

  it('should fall back to a declared version when nothing is installed', async () => {
    vi.mocked(getPkgJSON).mockReturnValue(null)
    vi.mocked(getPkgVersion).mockReturnValue('')

    await expect(resolveNitroVersion('/project', async name => name === 'nitropack' ? '^2.13.4' : undefined)).resolves.toBe('^2.13.4')
  })

  it('should return undefined when no version can be found', async () => {
    vi.mocked(getPkgJSON).mockReturnValue(null)
    vi.mocked(getPkgVersion).mockReturnValue('')

    await expect(resolveNitroVersion('/project', async () => undefined)).resolves.toBeUndefined()
  })
})
