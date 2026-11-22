import type { PackageJson } from 'pkg-types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNitroVersion, getProjectNitroMajor, readNitroMajor, resolveNitroMajor, resolveNitroVersion, supportsHttp2, supportsNitroMajor } from '../../../src/utils/nitro'
import { getNuxtPkgVersion, getPkgJSON, getPkgVersion, getProjectPkgJSON } from '../../../src/utils/pkg'
import { findPnpmWorkspaceYaml } from '../../../src/utils/workspace'

vi.mock('../../../src/utils/workspace', () => ({
  findPnpmWorkspaceYaml: vi.fn(),
}))

vi.mock('../../../src/utils/pkg', () => ({
  getNuxtPkgVersion: vi.fn(),
  getPkgJSON: vi.fn(),
  getPkgVersion: vi.fn(),
  getProjectPkgJSON: vi.fn(),
}))

/** Describe the packages installed in the project by name. */
function installed(pkgs: Record<string, PackageJson>) {
  vi.mocked(getPkgJSON).mockImplementation((_cwd, pkg) => pkgs[pkg] ?? null)
  vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg) => pkgs[pkg]?.version ?? '')
}

/** Describe the project's own `package.json`. */
function project(pkg: PackageJson) {
  vi.mocked(getProjectPkgJSON).mockReturnValue(pkg)
}

/** Describe the `package.json` read at each directory. */
function manifests(byDir: Record<string, PackageJson>) {
  vi.mocked(getProjectPkgJSON).mockImplementation(dir => byDir[dir] ?? null)
}

/** Describe a workspace root at `/workspace` whose project declares nothing. */
function workspaceRoot(pkg: PackageJson) {
  vi.mocked(findPnpmWorkspaceYaml).mockReturnValue('/workspace/pnpm-workspace.yaml')
  manifests({
    '/project': {},
    '/workspace': pkg,
  })
}

beforeEach(() => {
  vi.mocked(findPnpmWorkspaceYaml).mockReset()
  vi.mocked(getNuxtPkgVersion).mockReset()
  vi.mocked(getPkgJSON).mockReset()
  vi.mocked(getPkgVersion).mockReset()
  vi.mocked(getProjectPkgJSON).mockReset()
})

describe('getProjectNitroMajor', () => {
  it('should select 3 for nitro and 2 for nitropack', () => {
    project({
      dependencies: { nitro: '^3.0.0' },
    })
    expect(getProjectNitroMajor('/project')).toBe(3)

    project({
      dependencies: { nitropack: '^2.13.4' },
    })
    expect(getProjectNitroMajor('/project')).toBe(2)
  })

  it('should prefer nitro when both are declared', () => {
    project({
      dependencies: { nitro: '^3.0.0', nitropack: '^2.13.4' },
    })
    expect(getProjectNitroMajor('/project')).toBe(3)
  })

  it('should read devDependencies too', () => {
    project({
      devDependencies: { nitropack: '^2.13.4' },
    })
    expect(getProjectNitroMajor('/project')).toBe(2)
  })

  it('should return undefined when neither is declared', () => {
    project({})
    expect(getProjectNitroMajor('/project')).toBeUndefined()
  })

  it('should follow the workspace root when it declares exactly one package', () => {
    workspaceRoot({
      dependencies: { nitro: '^3.0.0' },
    })
    expect(getProjectNitroMajor('/project')).toBe(3)

    workspaceRoot({
      devDependencies: { nitropack: '^2.13.4' },
    })
    expect(getProjectNitroMajor('/project')).toBe(2)
  })

  it('should ignore a workspace root that declares both packages', () => {
    workspaceRoot({
      dependencies: { nitro: '^3.0.0', nitropack: '^2.13.4' },
    })
    expect(getProjectNitroMajor('/project')).toBeUndefined()
  })

  it('should prefer the project manifest over the workspace root', () => {
    vi.mocked(findPnpmWorkspaceYaml).mockReturnValue('/workspace/pnpm-workspace.yaml')
    manifests({
      '/project': {
        dependencies: { nitropack: '^2.13.4' },
      },
      '/workspace': {
        dependencies: { nitro: '^3.0.0' },
      },
    })

    expect(getProjectNitroMajor('/project')).toBe(2)
  })

  it('should ignore a workspace root that is the project itself', () => {
    vi.mocked(findPnpmWorkspaceYaml).mockReturnValue('/project/pnpm-workspace.yaml')
    project({})

    expect(getProjectNitroMajor('/project')).toBeUndefined()
  })
})

describe('readNitroMajor', () => {
  it('should read 2 and 3 only', () => {
    expect(readNitroMajor({ _nitroMajor: 2 })).toBe(2)
    expect(readNitroMajor({ _nitroMajor: 3 })).toBe(3)
  })

  it('should ignore a missing or other value', () => {
    expect(readNitroMajor({})).toBeUndefined()
    expect(readNitroMajor(null)).toBeUndefined()
    expect(readNitroMajor({ _nitroMajor: 4 })).toBeUndefined()
  })
})

describe('supportsNitroMajor', () => {
  it('should be true from 4.7.0 and false before it', () => {
    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.7.0')
    expect(supportsNitroMajor('/project')).toBe(true)

    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.6.2')
    expect(supportsNitroMajor('/project')).toBe(false)
  })

  it('should ignore a prerelease or nightly suffix', () => {
    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.7.0-2611.abc')
    expect(supportsNitroMajor('/project')).toBe(true)

    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.6.2-2611.abc')
    expect(supportsNitroMajor('/project')).toBe(false)
  })
})

describe('resolveNitroMajor', () => {
  it('should use the major passed from Nuxt', () => {
    expect(resolveNitroMajor('/project', 3)).toBe(3)
  })

  it('should derive on a supported Nuxt when no major is passed', () => {
    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.7.0')
    project({
      dependencies: { nitro: '^3.0.0' },
    })

    expect(resolveNitroMajor('/project')).toBe(3)
  })

  it('should ignore project declarations on an older Nuxt', () => {
    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.6.2')
    project({
      dependencies: { nitro: '^3.0.0' },
    })

    expect(resolveNitroMajor('/project')).toBeUndefined()
  })

  it('should ignore the workspace root on an older Nuxt', () => {
    vi.mocked(getNuxtPkgVersion).mockReturnValue('4.6.2')
    workspaceRoot({
      dependencies: { nitro: '^3.0.0' },
    })

    expect(resolveNitroMajor('/project')).toBeUndefined()
  })
})

describe('getNitroVersion', () => {
  it('should read the version nuxt declares', () => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.13.4' },
      },
      nitropack: { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
    expect(getPkgVersion).toHaveBeenCalledWith('/project', 'nitropack', {
      via: ['nuxt'],
      strict: true,
    })
  })

  it('should follow nuxt\'s declared @nuxt/nitro-server', () => {
    installed({
      'nuxt': {
        dependencies: { '@nuxt/nitro-server': '^5.0.0' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitro: '^3.0.0' },
      },
      'nitro': { version: '3.0.0' },
    })

    expect(getNitroVersion('/project')).toBe('3.0.0')
    expect(getPkgVersion).toHaveBeenCalledWith('/project', 'nitro', {
      via: ['nuxt', '@nuxt/nitro-server'],
      strict: true,
    })
  })

  it('should ignore @nuxt/nitro-server when nuxt does not declare it', () => {
    installed({
      'nuxt': {
        dependencies: { nitropack: '^2.13.4' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitro: '^3.0.0' },
      },
      'nitropack': { version: '2.13.4' },
      'nitro': { version: '3.0.0' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should read the version nuxt-nightly declares', () => {
    installed({
      'nuxt-nightly': {
        dependencies: { nitropack: '^2.13.4' },
      },
      'nitropack': { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should read an aliased nightly dependency under its declared name', () => {
    installed({
      nuxt: {
        dependencies: { nitropack: 'npm:nitropack-nightly@latest' },
      },
      nitropack: { version: '2.14.0-nightly' },
    })

    expect(getNitroVersion('/project')).toBe('2.14.0-nightly')
  })

  it('should prefer the current name when nuxt declares several', () => {
    installed({
      nuxt: {
        dependencies: { nitro: '^3.0.0', nitropack: '^2.13.4' },
      },
      nitro: { version: '3.0.0' },
      nitropack: { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('3.0.0')
  })

  it('should fall back to an installed nitro when nuxt declares none', () => {
    installed({
      nuxt: {
        dependencies: { vue: '^3.5.0' },
      },
      nitropack: { version: '2.13.4' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should fall back when the declared package cannot be resolved', () => {
    installed({
      nitropack: { version: '2.13.4' },
    })
    vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg, options) => pkg === 'nitropack' && !options?.via
      ? '2.13.4'
      : '')

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })

  it('should return an empty string when nitro is not installed', () => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.13.4' },
      },
    })

    expect(getNitroVersion('/project')).toBe('')
  })

  it('should report the matching package over the one nuxt depends on', () => {
    installed({
      'nuxt': {
        dependencies: { '@nuxt/nitro-server': '^5.0.0' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitropack: '^2.13.4' },
      },
      'nitro': { version: '3.0.0' },
      'nitropack': { version: '2.13.4' },
    })

    expect(getNitroVersion('/project', 3)).toBe('3.0.0')
  })

  it('should select nitropack for major 2 even when nuxt declares nitro', () => {
    installed({
      'nuxt': {
        dependencies: { '@nuxt/nitro-server': '^5.0.0' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitro: '^3.0.0' },
      },
      'nitro': { version: '3.0.0' },
      'nitropack': { version: '2.13.4' },
    })

    expect(getNitroVersion('/project', 2)).toBe('2.13.4')
  })

  it('should fall back to nuxt\'s declared chain when the matching package is not directly installed', () => {
    installed({
      'nuxt': {
        dependencies: { '@nuxt/nitro-server': '^5.0.0' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitro: '^3.0.0' },
      },
    })
    project({
      dependencies: { nitro: '^3.0.0' },
    })
    vi.mocked(getPkgVersion).mockImplementation((_cwd, pkg, options) => pkg === 'nitro' && options?.via
      ? '3.0.0'
      : '')

    expect(getNitroVersion('/project', 3)).toBe('3.0.0')
  })

  it('should prefer the project copy of the matching package', () => {
    installed({
      nuxt: {
        dependencies: { nitro: '^3.0.0' },
      },
      nitro: { version: '3.0.0' },
    })
    project({
      dependencies: { nitro: '^3.0.0' },
    })
    vi.mocked(getPkgVersion).mockImplementation((_cwd, _pkg, options) => options?.via ? '3.5.0' : '4.0.0')

    expect(getNitroVersion('/project', 3)).toBe('4.0.0')
  })

  it('should prefer the nuxt-declared chain when the project does not declare the package', () => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.13.4' },
      },
      nitropack: { version: '2.13.4' },
    })
    project({})
    vi.mocked(getPkgVersion).mockImplementation((_cwd, _pkg, options) => options?.via ? '2.13.4' : '9.9.9')

    expect(getNitroVersion('/project', 2)).toBe('2.13.4')
  })

  it('should keep today\'s lookup when no major is given', () => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.13.4' },
      },
      nitro: { version: '3.0.0' },
      nitropack: { version: '2.13.4' },
    })
    project({
      dependencies: { nitro: '^3.0.0' },
    })

    expect(getNitroVersion('/project')).toBe('2.13.4')
  })
})

describe('supportsHttp2', () => {
  it.each([
    ['2.12.9', false],
    ['2.13.2', false],
    ['2.13.3', true],
    ['2.14.0-nightly', true],
  ])('should report nitropack %s as %s', (version, supported) => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.12.0' },
      },
      nitropack: { version },
    })

    expect(supportsHttp2('/project')).toBe(supported)
  })

  it('should support Nitro 3', () => {
    installed({
      'nuxt': {
        dependencies: { '@nuxt/nitro-server': '^5.0.0' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitro: '^3.0.0' },
      },
      'nitro': { version: '3.0.260903-beta' },
    })

    expect(supportsHttp2('/project')).toBe(true)
  })

  it('should assume support when no Nitro version can be read', () => {
    installed({})

    expect(supportsHttp2('/project')).toBe(true)
  })
})

describe('resolveNitroVersion', () => {
  it('should prefer the installed version', async () => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.13.4' },
      },
      nitropack: { version: '2.13.4' },
    })

    await expect(resolveNitroVersion('/project', async () => '2.0.0')).resolves.toBe('2.13.4')
  })

  it('should prefer the declared version of the package nuxt depends on', async () => {
    installed({
      nuxt: {
        dependencies: { nitropack: '^2.13.4' },
      },
    })

    await expect(resolveNitroVersion('/project', async name => ({ nitro: '^3.0.0', nitropack: '^2.13.4' }[name]))).resolves.toBe('^2.13.4')
  })

  it('should fall back to a declared version when nothing is installed', async () => {
    installed({})

    await expect(resolveNitroVersion('/project', async name => name === 'nitropack'
      ? '^2.13.4'
      : undefined)).resolves.toBe('^2.13.4')
  })

  it('should return undefined when no version can be found', async () => {
    installed({})

    await expect(resolveNitroVersion('/project', async () => undefined)).resolves.toBeUndefined()
  })

  it('should respect the nitro major selected by the project', async () => {
    installed({
      'nuxt': {
        dependencies: { '@nuxt/nitro-server': '^5.0.0' },
      },
      '@nuxt/nitro-server': {
        dependencies: { nitropack: '^2.13.4' },
      },
      'nitro': { version: '3.0.0' },
      'nitropack': { version: '2.13.4' },
    })
    project({
      dependencies: { nitro: '^3.0.0' },
    })

    await expect(resolveNitroVersion(
      '/project',
      async name => ({ nitro: '^3.0.0', nitropack: '^2.13.4' }[name]),
      getProjectNitroMajor('/project'),
    )).resolves.toBe('3.0.0')
  })

  it('should fall back to the declared version of the selected major', async () => {
    installed({
      nuxt: {
        dependencies: { nitro: '^3.0.0' },
      },
    })
    project({
      dependencies: { nitropack: '^2.13.4' },
    })

    await expect(resolveNitroVersion(
      '/project',
      async name => ({ nitro: '^3.0.0', nitropack: '^2.13.4' }[name]),
      getProjectNitroMajor('/project'),
    )).resolves.toBe('^2.13.4')
  })
})
