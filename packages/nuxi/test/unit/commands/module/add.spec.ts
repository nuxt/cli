import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as moduleSkills from '../../../../src/commands/module/_skills'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run'
import * as versions from '../../../../src/utils/versions'

const updateConfig = vi.fn(() => Promise.resolve())
const addDependency = vi.fn(() => Promise.resolve())
const detectPackageManager = vi.fn(() => Promise.resolve({ name: 'npm' }))
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
      addDependency,
      detectPackageManager,
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
  const runCommandSpy = vi.spyOn(runCommands, 'runCommand')
  const getNuxtVersionSpy = vi.spyOn(versions, 'getNuxtVersion')
  const fetchModulesSpy = vi.spyOn(utils, 'fetchModules')
  fetchModulesSpy.mockResolvedValue([
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
    vi.clearAllMocks()
    getNuxtVersionSpy.mockResolvedValue('3.0.0')
    runCommandSpy.mockImplementation(vi.fn())
    fetchModulesSpy.mockResolvedValue([
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
  })

  it('should  install Nuxt module', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content'],
      },
    })

    expect(addDependency).toHaveBeenCalledWith([`@nuxt/content@${v3}`], {
      cwd: '/fake-dir',
      dev: true,
      installPeerDependencies: true,
      packageManager: {
        name: 'npm',
      },
      workspace: false,
    })
  })

  it('should convert versioned module to Nuxt module', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content@2.9.0'],
      },
    })

    expect(addDependency).toHaveBeenCalledWith(['@nuxt/content@2.9.0'], {
      cwd: '/fake-dir',
      dev: true,
      installPeerDependencies: true,
      packageManager: {
        name: 'npm',
      },
      workspace: false,
    })
  })

  it('should convert major only version to full semver', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content@2'],
      },
    })

    expect(addDependency).toHaveBeenCalledWith(['@nuxt/content@2.13.1'], {
      cwd: '/fake-dir',
      dev: true,
      installPeerDependencies: true,
      packageManager: {
        name: 'npm',
      },
      workspace: false,
    })
  })

  it('should convert not full version to full semver', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content@3.1'],
      },
    })

    expect(addDependency).toHaveBeenCalledWith(['@nuxt/content@3.1.1'], {
      cwd: '/fake-dir',
      dev: true,
      installPeerDependencies: true,
      packageManager: {
        name: 'npm',
      },
      workspace: false,
    })
  })

  it('should continue module add when skill discovery fails', async () => {
    vi.spyOn(moduleSkills, 'detectModuleSkills').mockRejectedValueOnce(new Error('broken skill scanner'))

    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content'],
      },
    })

    expect(addDependency).toHaveBeenCalled()
    expect(runCommands.runCommand).toHaveBeenCalledTimes(1)
  })

  it('should not install skills when no skills are detected', async () => {
    const installSpy = vi.spyOn(moduleSkills, 'installModuleSkills')

    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['content'],
      },
    })

    expect(installSpy).not.toHaveBeenCalled()
    expect(runCommands.runCommand).toHaveBeenCalledTimes(1)
  })
})
