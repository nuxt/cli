import type { PackageJson } from 'pkg-types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNitroVersion, resolveNitroVersion } from '../../../src/utils/nitro'
import { getPkgJSON, getPkgVersion } from '../../../src/utils/pkg'

vi.mock('../../../src/utils/pkg', () => ({
  getPkgJSON: vi.fn(),
  getPkgVersion: vi.fn(),
}))

/** Describe the packages installed in the project by name. */
function installed(pkgs: Record<string, PackageJson>) {
  vi.mocked(getPkgJSON).mockImplementation((_cwd, pkg) => pkgs[pkg] ?? null)
  vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg) => pkgs[pkg]?.version ?? '')
}

beforeEach(() => {
  vi.mocked(getPkgJSON).mockReset()
  vi.mocked(getPkgVersion).mockReset()
})

describe('getNitroVersion', () => {
  it('should read the version nuxt declares', () => {
    installed({
      nuxt: { dependencies: { nitropack: '^2.13.4' } },
      nitropack: { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
    expect(getPkgVersion).toHaveBeenCalledWith('/project', 'nitropack', { via: ['nuxt'], strict: true })
  })

  it('should follow nuxt\'s declared @nuxt/nitro-server', () => {
    installed({
      'nuxt': { dependencies: { '@nuxt/nitro-server': '^5.0.0' } },
      '@nuxt/nitro-server': { dependencies: { nitro: '^3.0.0' } },
      'nitro': { version: '3.0.0' },
    })

    expect(getNitroVersion('/project')).toBe('3.0.0')
    expect(getPkgVersion).toHaveBeenCalledWith('/project', 'nitro', { via: ['nuxt', '@nuxt/nitro-server'], strict: true })
  })

  it('should ignore @nuxt/nitro-server when nuxt does not declare it', () => {
    installed({
      'nuxt': { dependencies: { nitropack: '^2.13.4' } },
      '@nuxt/nitro-server': { dependencies: { nitro: '^3.0.0' } },
      'nitropack': { version: '2.13.4' },
      'nitro': { version: '3.0.0' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should read the version nuxt-nightly declares', () => {
    installed({
      'nuxt-nightly': { dependencies: { nitropack: '^2.13.4' } },
      'nitropack': { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should read an aliased nightly dependency under its declared name', () => {
    installed({
      nuxt: { dependencies: { nitropack: 'npm:nitropack-nightly@latest' } },
      nitropack: { version: '2.14.0-nightly' },
    })

    expect(getNitroVersion('/project')).toBe('2.14.0-nightly')
  })

  it('should prefer the current name when nuxt declares several', () => {
    installed({
      nuxt: { dependencies: { nitro: '^3.0.0', nitropack: '^2.13.4' } },
      nitro: { version: '3.0.0' },
      nitropack: { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('3.0.0')
  })

  it('should fall back to an installed nitro when nuxt declares none', () => {
    installed({
      nuxt: { dependencies: { vue: '^3.5.0' } },
      nitropack: { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should fall back when the declared package cannot be resolved', () => {
    installed({ nitropack: { version: '2.13.4' } })
    vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg, options) => pkg === 'nitropack' && !options?.via ? '2.13.4' : '')

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should return an empty string when nitro is not installed', () => {
    installed({ nuxt: { dependencies: { nitropack: '^2.13.4' } } })

    expect(getNitroVersion('/project')).toBe('')
  })
})

describe('resolveNitroVersion', () => {
  it('should prefer the installed version', async () => {
    installed({
      nuxt: { dependencies: { nitropack: '^2.13.4' } },
      nitropack: { version: '2.13.4' },
    })

    await expect(resolveNitroVersion('/project', async () => '2.0.0')).resolves.toBe('2.13.4')
  })

  it('should prefer the declared version of the package nuxt depends on', async () => {
    installed({ nuxt: { dependencies: { nitropack: '^2.13.4' } } })

    await expect(resolveNitroVersion('/project', async name => ({ nitro: '^3.0.0', nitropack: '^2.13.4' }[name]))).resolves.toBe('^2.13.4')
  })

  it('should fall back to a declared version when nothing is installed', async () => {
    installed({})

    await expect(resolveNitroVersion('/project', async name => name === 'nitropack' ? '^2.13.4' : undefined)).resolves.toBe('^2.13.4')
  })

  it('should return undefined when no version can be found', async () => {
    installed({})

    await expect(resolveNitroVersion('/project', async () => undefined)).resolves.toBeUndefined()
  })
})
