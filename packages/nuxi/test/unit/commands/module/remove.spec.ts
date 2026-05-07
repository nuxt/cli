import { beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run'

const updateConfig = vi.fn(() => Promise.resolve())
const removeDependency = vi.fn(() => Promise.resolve())
const detectPackageManager = vi.fn(() => Promise.resolve({ name: 'npm' }))

interface CommandsType {
  subCommands: {
    remove: () => Promise<{ setup: (args: any) => Promise<void> }>
  }
}

vi.mock('c12/update', () => ({ updateConfig }))
vi.mock('nypm', () => ({ removeDependency, detectPackageManager }))
vi.mock('pkg-types', () => ({
  readPackageJSON: () => Promise.resolve({
    devDependencies: { nuxt: '3.0.0' },
    dependencies: { '@nuxt/content': '^3.0.0' },
  }),
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

  it('should skip uninstall when --skipUninstall is set', async () => {
    const removeCommand = await (commands as CommandsType).subCommands.remove()
    await removeCommand.setup({
      args: {
        cwd: '/fake-dir',
        skipUninstall: true,
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
})
