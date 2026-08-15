import { beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run-command'

interface FakeConfig { file: string, cwd: string, modules: string[], extends: string[] }

const readNuxtConfig = vi.fn((): Promise<FakeConfig | undefined> => Promise.resolve({ file: '/fake-dir/nuxt.config.ts', cwd: '/fake-dir', modules: ['@nuxt/content'], extends: [] }))
const removeNuxtConfigEntries = vi.fn(() => Promise.resolve())
const removeDependency = vi.fn(() => Promise.resolve())
const detectPackageManager = vi.fn(() => Promise.resolve({ name: 'npm' }))
const confirm = vi.fn((): Promise<boolean | symbol> => Promise.resolve(false))
const multiselect = vi.fn((): Promise<string[] | symbol> => Promise.resolve([]))

const defaultProjectPkg = {
  devDependencies: { nuxt: '3.0.0' },
  dependencies: { '@nuxt/content': '^3.0.0' },
}

const readPackageJSON = vi.fn((): Promise<Record<string, unknown>> => Promise.resolve(defaultProjectPkg))
const readDependencyPackageJson = vi.fn((_name?: string): Promise<Record<string, unknown> | undefined> => Promise.resolve(undefined))

interface CommandsType {
  subCommands: {
    remove: () => Promise<{ setup: (args: any) => Promise<void> }>
  }
}

vi.mock('../../../../src/utils/config', () => ({ readNuxtConfig, removeNuxtConfigEntries }))
vi.mock('nypm', () => ({ removeDependency, detectPackageManager }))
vi.mock('pkg-types', () => ({ readPackageJSON }))
vi.mock('../../../../src/utils/package-json', () => ({ readDependencyPackageJson }))
vi.mock('@clack/prompts', async importOriginal => ({
  ...await importOriginal<typeof import('@clack/prompts')>(),
  confirm: (...args: unknown[]) => confirm(...(args as [])),
  multiselect: (...args: unknown[]) => multiselect(...(args as [])),
}))

describe('module remove', () => {
  vi.spyOn(runCommands, 'runCommandDef').mockImplementation(vi.fn())
  vi.spyOn(utils, 'fetchModules').mockResolvedValue([
    {
      name: 'content',
      npm: '@nuxt/content',
      compatibility: {
        nuxt: '3.0.0',
        versionMap: {},
      },
      description: '',
      repo: '',
      github: '',
      website: '',
      learn_more: '',
      category: '',
      type: 'community',
      maintainers: [],
      stats: {
        downloads: 0,
        stars: 0,
        maintainers: 0,
        contributors: 0,
        modules: 0,
      },
    },
  ])

  beforeEach(() => {
    readNuxtConfig.mockClear()
    removeNuxtConfigEntries.mockClear()
    removeDependency.mockClear()
    confirm.mockReset().mockResolvedValue(false)
    multiselect.mockReset().mockResolvedValue([])
    readPackageJSON.mockReset().mockImplementation(() => Promise.resolve(defaultProjectPkg))
    readDependencyPackageJson.mockReset().mockImplementation(() => Promise.resolve(undefined))
  })

  it('should remove a Nuxt module by alias', async () => {
    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content'],
      },
    })

    expect(removeDependency).toHaveBeenCalledWith(['@nuxt/content'], {
      cwd: '/fake-dir',
      packageManager: { name: 'npm' },
      workspace: false,
    })
  })

  it('should strip a database module subpath before uninstalling', async () => {
    readPackageJSON.mockResolvedValueOnce({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: { example: '1.0.0' },
    })
    vi.mocked(utils.fetchModules).mockResolvedValueOnce([{
      name: 'example',
      npm: 'example/nuxt',
      aliases: ['example-module'],
      compatibility: { nuxt: '3.0.0', versionMap: {} },
      description: '',
      repo: '',
      github: '',
      website: '',
      learn_more: '',
      category: '',
      type: 'community',
      maintainers: [],
      stats: { downloads: 0, stars: 0, maintainers: 0, contributors: 0, modules: 0 },
    }])

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({ args: { cwd: '/fake-dir', skipConfig: true, _: ['example-module'] } })

    expect(removeDependency).toHaveBeenCalledWith(['example'], expect.objectContaining({ cwd: '/fake-dir' }))
  })

  it('should remove a Nuxt module by npm name', async () => {
    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@nuxt/content'],
      },
    })

    expect(removeDependency).toHaveBeenCalledWith(['@nuxt/content'], {
      cwd: '/fake-dir',
      packageManager: { name: 'npm' },
      workspace: false,
    })
  })

  it('should remove modules selected from the picker when none are given', async () => {
    multiselect.mockResolvedValueOnce(['@nuxt/content'])

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: [],
      },
    })

    expect(multiselect).toHaveBeenCalled()
    expect(removeDependency).toHaveBeenCalledWith(['@nuxt/content'], expect.objectContaining({ cwd: '/fake-dir' }))
  })

  it('should remove a layer from `extends` without uninstalling a local path', async () => {
    readNuxtConfig.mockResolvedValueOnce({ file: '/fake-dir/nuxt.config.ts', cwd: '/fake-dir', modules: [], extends: ['./layers/admin', 'nuxt-seo-kit'] })
    multiselect.mockResolvedValueOnce(['./layers/admin'])

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: [],
      },
    })

    expect(removeNuxtConfigEntries).toHaveBeenCalledWith(expect.anything(), { extends: ['./layers/admin'] })
    expect(removeDependency).not.toHaveBeenCalled()
  })

  it('should skip uninstall when --skipInstall is set', async () => {
    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        skipInstall: true,
        _: ['@nuxt/content'],
      },
    })

    expect(removeDependency).not.toHaveBeenCalled()
  })

  it('should stop before uninstall when the config update fails', async () => {
    removeNuxtConfigEntries.mockRejectedValueOnce(new Error('read only'))

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await expect(removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@nuxt/content'],
      },
    })).rejects.toThrow('process.exit unexpectedly called with "1"')

    expect(removeDependency).not.toHaveBeenCalled()
  })

  it('should skip config update when --skipConfig is set', async () => {
    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        skipConfig: true,
        _: ['@nuxt/content'],
      },
    })

    expect(readNuxtConfig).not.toHaveBeenCalled()
  })

  it('should not uninstall a module that is not in dependencies', async () => {
    readPackageJSON.mockImplementation(() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {},
    }))

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@nuxt/content'],
      },
    })

    expect(removeDependency).not.toHaveBeenCalled()
  })

  it('should remove orphaned peer dependencies when confirmed', async () => {
    confirm.mockResolvedValueOnce(true)
    readPackageJSON.mockImplementation(() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {
        '@vee-validate/nuxt': '1.0.0',
        'vee-validate': '4.0.0',
      },
    }))
    readDependencyPackageJson.mockImplementation((name?: string) => Promise.resolve(
      name === '@vee-validate/nuxt' ? { peerDependencies: { 'vee-validate': '^4.0.0' } } : {},
    ))

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@vee-validate/nuxt'],
      },
    })

    expect(confirm).toHaveBeenCalled()
    expect(removeDependency).toHaveBeenCalledWith(
      ['@vee-validate/nuxt', 'vee-validate'],
      expect.objectContaining({ cwd: '/fake-dir' }),
    )
  })

  it('should not suggest removing optional peer dependencies', async () => {
    readPackageJSON.mockImplementation(() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {
        '@example/nuxt': '1.0.0',
        'optional-package': '1.0.0',
      },
    }))
    readDependencyPackageJson.mockImplementation((name?: string) => Promise.resolve(
      name === '@example/nuxt'
        ? { peerDependencies: { 'optional-package': '^1.0.0' }, peerDependenciesMeta: { 'optional-package': { optional: true } } }
        : {},
    ))

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({ args: { cwd: '/fake-dir', _: ['@example/nuxt'] } })

    expect(confirm).not.toHaveBeenCalled()
    expect(removeDependency).toHaveBeenCalledWith(['@example/nuxt'], expect.objectContaining({ cwd: '/fake-dir' }))
  })

  it('should keep orphaned peer dependencies when declined', async () => {
    confirm.mockResolvedValueOnce(false)
    readPackageJSON.mockImplementation(() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {
        '@vee-validate/nuxt': '1.0.0',
        'vee-validate': '4.0.0',
      },
    }))
    readDependencyPackageJson.mockImplementation((name?: string) => Promise.resolve(
      name === '@vee-validate/nuxt' ? { peerDependencies: { 'vee-validate': '^4.0.0' } } : {},
    ))

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@vee-validate/nuxt'],
      },
    })

    expect(confirm).toHaveBeenCalled()
    expect(removeDependency).toHaveBeenCalledWith(
      ['@vee-validate/nuxt'],
      expect.objectContaining({ cwd: '/fake-dir' }),
    )
  })

  it('should inspect retained dependencies in parallel', async () => {
    let pending = 0
    let peak = 0
    readPackageJSON.mockImplementation(() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {
        '@vee-validate/nuxt': '1.0.0',
        'first': '1.0.0',
        'second': '1.0.0',
        'vee-validate': '4.0.0',
      },
    }))
    readDependencyPackageJson.mockImplementation(async (name?: string) => {
      if (name === '@vee-validate/nuxt') {
        return { peerDependencies: { 'vee-validate': '^4.0.0' } }
      }
      pending++
      peak = Math.max(peak, pending)
      await Promise.resolve()
      pending--
      return {}
    })

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({ args: { cwd: '/fake-dir', _: ['@vee-validate/nuxt'] } })

    expect(peak).toBeGreaterThan(1)
  })

  it('should not treat a peer still required by another dependency as orphaned', async () => {
    readPackageJSON.mockImplementation(() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {
        '@vee-validate/nuxt': '1.0.0',
        'some-other-dep': '1.0.0',
        'vee-validate': '4.0.0',
      },
    }))
    readDependencyPackageJson.mockImplementation((name?: string) => {
      if (name === '@vee-validate/nuxt') {
        return Promise.resolve({ peerDependencies: { 'vee-validate': '^4.0.0' } })
      }
      if (name === 'some-other-dep') {
        return Promise.resolve({ dependencies: { 'vee-validate': '^4.0.0' } })
      }
      return Promise.resolve({})
    })

    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@vee-validate/nuxt'],
      },
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(removeDependency).toHaveBeenCalledWith(
      ['@vee-validate/nuxt'],
      expect.objectContaining({ cwd: '/fake-dir' }),
    )
  })
})
