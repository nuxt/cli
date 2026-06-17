import { beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run'

const updateConfig = vi.fn(() => Promise.resolve())
const removeDependency = vi.fn(() => Promise.resolve())
const detectPackageManager = vi.fn(() => Promise.resolve({ name: 'npm' }))
const confirm = vi.fn((): Promise<boolean | symbol> => Promise.resolve(false))
const multiselect = vi.fn((): Promise<string[] | symbol> => Promise.resolve([]))

const defaultProjectPkg = {
  devDependencies: { nuxt: '3.0.0' },
  dependencies: { '@nuxt/content': '^3.0.0' },
}

const readPackageJSON = vi.fn(() => Promise.resolve(defaultProjectPkg))

interface CommandsType {
  subCommands: {
    remove: () => Promise<{ setup: (args: any) => Promise<void> }>
  }
}

vi.mock('c12/update', () => ({ updateConfig }))
vi.mock('nypm', () => ({ removeDependency, detectPackageManager }))
vi.mock('pkg-types', () => ({ readPackageJSON }))
vi.mock('@clack/prompts', async importOriginal => ({
  ...await importOriginal<typeof import('@clack/prompts')>(),
  confirm: (...args: unknown[]) => confirm(...(args as [])),
  multiselect: (...args: unknown[]) => multiselect(...(args as [])),
}))

describe('module remove', () => {
  vi.spyOn(runCommands, 'runCommand').mockImplementation(vi.fn())
  vi.spyOn(utils, 'fetchModules').mockResolvedValue([
    {
      name: 'content',
      npm: '@nuxt/content',
      compatibility: {
        nuxt: '3.0.0',
        requires: {},
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
    updateConfig.mockClear()
    removeDependency.mockClear()
    confirm.mockReset().mockResolvedValue(false)
    multiselect.mockReset().mockResolvedValue([])
    readPackageJSON.mockReset().mockImplementation(() => Promise.resolve(defaultProjectPkg))
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
    updateConfig.mockImplementationOnce((async (config: any) => {
      await config.onUpdate({ modules: ['@nuxt/content'] })
    }) as typeof updateConfig)
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

  it('should skip config update when --skipConfig is set', async () => {
    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        skipConfig: true,
        _: ['@nuxt/content'],
      },
    })

    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('should not uninstall a module that is not in dependencies', async () => {
    readPackageJSON.mockImplementation((() => Promise.resolve({
      devDependencies: { nuxt: '3.0.0' },
      dependencies: {},
    })) as typeof readPackageJSON)

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
    readPackageJSON.mockImplementation(((id?: string) => {
      if (id === '@vee-validate/nuxt') {
        return Promise.resolve({ peerDependencies: { 'vee-validate': '^4.0.0' } })
      }
      if (id === 'vee-validate' || id === 'nuxt') {
        return Promise.resolve({})
      }
      return Promise.resolve({
        devDependencies: { nuxt: '3.0.0' },
        dependencies: {
          '@vee-validate/nuxt': '1.0.0',
          'vee-validate': '4.0.0',
        },
      })
    }) as typeof readPackageJSON)

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

  it('should keep orphaned peer dependencies when declined', async () => {
    confirm.mockResolvedValueOnce(false)
    readPackageJSON.mockImplementation(((id?: string) => {
      if (id === '@vee-validate/nuxt') {
        return Promise.resolve({ peerDependencies: { 'vee-validate': '^4.0.0' } })
      }
      if (id === 'vee-validate' || id === 'nuxt') {
        return Promise.resolve({})
      }
      return Promise.resolve({
        devDependencies: { nuxt: '3.0.0' },
        dependencies: {
          '@vee-validate/nuxt': '1.0.0',
          'vee-validate': '4.0.0',
        },
      })
    }) as typeof readPackageJSON)

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

  it('should not treat a peer still required by another dependency as orphaned', async () => {
    readPackageJSON.mockImplementation(((id?: string) => {
      if (id === '@vee-validate/nuxt') {
        return Promise.resolve({ peerDependencies: { 'vee-validate': '^4.0.0' } })
      }
      if (id === 'some-other-dep') {
        return Promise.resolve({ dependencies: { 'vee-validate': '^4.0.0' } })
      }
      if (id === 'vee-validate' || id === 'nuxt') {
        return Promise.resolve({})
      }
      return Promise.resolve({
        devDependencies: { nuxt: '3.0.0' },
        dependencies: {
          '@vee-validate/nuxt': '1.0.0',
          'some-other-dep': '1.0.0',
          'vee-validate': '4.0.0',
        },
      })
    }) as typeof readPackageJSON)

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
