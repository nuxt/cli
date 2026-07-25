import { beforeAll, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run'
import * as installUtils from '../../../../src/utils/install'
import * as versions from '../../../../src/utils/versions'

const { updateConfig, detectPackageManager } = vi.hoisted(() => ({
  updateConfig: vi.fn(() => Promise.resolve()),
  detectPackageManager: vi.fn(() => Promise.resolve({ name: 'npm', command: 'npm' })),
}))

let v3 = '3.0.0'
interface CommandsType {
  subCommands: {
    // biome-ignore lint/correctness/noEmptyPattern: <explanation>
    add: () => Promise<{ setup: (args: any) => void }>
  }
}
function applyMocks() {
  vi.mock('c12/update', async () => {
    return {
      updateConfig,
    }
  })
  vi.mock('nypm', async () => {
    return {
      detectPackageManager,
      packageManagers: [{ name: 'npm', command: 'npm' }],
    }
  })
  vi.mock('pkg-types', async () => {
    return {
      readPackageJSON: () => {
        return new Promise((resolve) => {
          resolve({
            devDependencies: {
              nuxt: '3.0.0',
            },
          })
        })
      },
    }
  })
  vi.mock('ofetch', async () => {
    return {
      $fetch: vi.fn(() => Promise.resolve({
        'name': '@nuxt/content',
        'npm': '@nuxt/content',
        'devDependencies': {
          nuxt: v3,
        },
        'dist-tags': { latest: v3 },
        'versions': {
          [v3]: {
            devDependencies: {
              nuxt: v3,
            },
          },
          '3.1.1': {
            devDependencies: {
              nuxt: v3,
            },
          },
          '2.9.0': {
            devDependencies: {
              nuxt: v3,
            },
          },
          '2.13.1': {
            devDependencies: {
              nuxt: v3,
            },
          },
        },
      })),
    }
  })
}
describe('module add', () => {
  beforeAll(async () => {
    const response = await fetch('https://registry.npmjs.org/@nuxt/content')
    const json = await response.json()
    v3 = json['dist-tags'].latest
  })
  applyMocks()
  const runInstall = vi.spyOn(installUtils, 'runInstall').mockResolvedValue({ success: true, output: '', command: 'npm install' })
  vi.spyOn(runCommands, 'runCommandDef').mockImplementation(vi.fn())
  vi.spyOn(versions, 'getNuxtVersion').mockResolvedValue('3.0.0')
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

  it('should  install Nuxt module', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/fake-dir',
      dependencies: [`@nuxt/content@${v3}`],
      dev: true,
      packageManager: { name: 'npm', command: 'npm' },
      workspace: false,
    }))
  })

  it('should convert versioned module to Nuxt module', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content@2.9.0'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/fake-dir',
      dependencies: ['@nuxt/content@2.9.0'],
      dev: true,
      packageManager: { name: 'npm', command: 'npm' },
      workspace: false,
    }))
  })

  it('should convert major only version to full semver', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content@2'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/fake-dir',
      dependencies: ['@nuxt/content@2.13.1'],
      dev: true,
      packageManager: { name: 'npm', command: 'npm' },
      workspace: false,
    }))
  })

  it('should convert not full version to full semver', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content@3.1'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/fake-dir',
      dependencies: ['@nuxt/content@3.1.1'],
      dev: true,
      packageManager: { name: 'npm', command: 'npm' },
      workspace: false,
    }))
  })
})
