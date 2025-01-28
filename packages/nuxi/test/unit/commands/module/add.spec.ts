import { beforeAll, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run'

const updateConfig = vi.fn(() => Promise.resolve())
const addDependency = vi.fn(() => Promise.resolve())
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
}
describe('module add', () => {
  let v3: string
  beforeAll(async () => {
    v3 = await fetch('https://registry.npmjs.org/@nuxt/content')
      .then(r => r.json())
      .then(r => r['dist-tags'].latest)
  })
  applyMocks()
  vi.spyOn(runCommands, 'runCommand').mockImplementation(vi.fn())
  vi.spyOn(utils, 'getNuxtVersion').mockResolvedValue('3.0.0')
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

    expect(addDependency).toHaveBeenCalledWith([`@nuxt/content@${v3}`], {
      cwd: '/fake-dir',
      dev: true,
      installPeerDependencies: true,
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
    })
  })
})
