import type { MockInstance } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../src/commands/module'
import * as utils from '../../../src/commands/module/_utils'
import * as runCommands from '../../../src/run-command'
import * as installUtils from '../../../src/utils/install'
import * as versions from '../../../src/utils/versions'

const { readNuxtConfig, addNuxtConfigEntries, detectPackageManager, mock$fetch } = vi.hoisted(() => {
  return {
    readNuxtConfig: vi.fn(() => Promise.resolve({ file: '/fake-dir/nuxt.config.ts', cwd: '/fake-dir', modules: [], extends: [] })),
    addNuxtConfigEntries: vi.fn(() => Promise.resolve()),
    detectPackageManager: vi.fn(() => Promise.resolve({ name: 'npm', command: 'npm' })),
    mock$fetch: vi.fn(),
  }
})

vi.mock('../../../src/utils/config', async () => {
  return {
    readNuxtConfig,
    addNuxtConfigEntries,
    createNuxtConfig: vi.fn(),
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
      return Promise.resolve({
        devDependencies: {
          nuxt: '3.14.0',
        },
      })
    },
  }
})

vi.mock('../../../src/utils/fetch', async () => {
  return {
    fetchJson: mock$fetch,
  }
})

interface CommandsType {
  subCommands: {
    add: () => Promise<{ setup: (args: any) => void }>
  }
}

describe('nuxt add command', () => {
  let runInstall: MockInstance<typeof installUtils.runInstall>

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for fetchModules
    vi.spyOn(utils, 'fetchModules').mockResolvedValue([
      {
        name: 'ui',
        npm: '@nuxt/ui',
        compatibility: {
          nuxt: '^3.0.0',
          requires: {},
          versionMap: {},
        },
        description: 'Nuxt UI',
        repo: '',
        github: '',
        website: '',
        learn_more: '',
        category: '',
        type: 'official',
        maintainers: [],
        stats: {
          downloads: 0,
          stars: 0,
          maintainers: 0,
          contributors: 0,
          modules: 0,
        },
      },
      {
        name: 'icon',
        npm: '@nuxt/icon',
        compatibility: {
          nuxt: '^3.0.0',
          requires: {},
          versionMap: {},
        },
        description: 'Nuxt Icon',
        repo: '',
        github: '',
        website: '',
        learn_more: '',
        category: '',
        type: 'official',
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

    // Default mock for $fetch
    mock$fetch.mockImplementation((url: string) => {
      if (url.includes('@nuxt/ui')) {
        return Promise.resolve({
          'name': '@nuxt/ui',
          'dist-tags': { latest: '3.0.0' },
          'versions': {
            '3.0.0': {
              dependencies: {
                nuxt: '^3.0.0',
              },
            },
          },
        })
      }
      if (url.includes('@nuxt/icon')) {
        return Promise.resolve({
          'name': '@nuxt/icon',
          'dist-tags': { latest: '1.0.0' },
          'versions': {
            '1.0.0': {
              dependencies: {
                '@nuxt/kit': '^3.0.0',
              },
            },
          },
        })
      }
      return Promise.resolve({})
    })

    runInstall = vi.spyOn(installUtils, 'runInstall').mockResolvedValue({ success: true, output: '', command: 'npm install', ignoredBuilds: [] })
    vi.spyOn(runCommands, 'runCommandDef').mockImplementation(vi.fn())
    vi.spyOn(versions, 'getNuxtVersion').mockResolvedValue('3.14.0')
  })

  it('should install a Nuxt module by name', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/fake-dir',
        dependencies: ['@nuxt/ui@3.0.0'],
        dev: true,
        packageManager: { name: 'npm', command: 'npm' },
        workspace: false,
      }),
    )

    expect(addNuxtConfigEntries).toHaveBeenCalled()
  })

  it('should install a module by npm package name', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@nuxt/icon'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/fake-dir',
        dependencies: ['@nuxt/icon@1.0.0'],
        dev: true,
        packageManager: { name: 'npm', command: 'npm' },
        workspace: false,
      }),
    )
  })

  it('should install multiple modules with one modules database request', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui', 'icon'],
      },
    })

    expect(utils.fetchModules).toHaveBeenCalledTimes(1)
    expect(runInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/fake-dir',
        dependencies: ['@nuxt/ui@3.0.0', '@nuxt/icon@1.0.0'],
        dev: true,
        packageManager: { name: 'npm', command: 'npm' },
        workspace: false,
      }),
    )
  })

  it('should resolve duplicate modules once', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({ args: { cwd: '/fake-dir', _: ['ui', 'ui'] } })

    expect(mock$fetch).toHaveBeenCalledTimes(1)
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      dependencies: ['@nuxt/ui@3.0.0'],
    }))
  })

  it('should skip installation when skipInstall is true', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
        skipInstall: true,
      },
    })

    expect(runInstall).not.toHaveBeenCalled()
    expect(addNuxtConfigEntries).toHaveBeenCalled()
  })

  it('should skip config update when skipConfig is true', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
        skipConfig: true,
      },
    })

    expect(runInstall).toHaveBeenCalled()
    expect(addNuxtConfigEntries).not.toHaveBeenCalled()
  })

  it('should install as dev dependency when dev flag is true', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
        dev: true,
      },
    })

    expect(runInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencies: ['@nuxt/ui@3.0.0'],
        dev: true,
      }),
    )
  })

  it('should handle versioned module installation', async () => {
    mock$fetch.mockImplementation((url: string) => {
      if (url.includes('@nuxt/ui')) {
        return Promise.resolve({
          'name': '@nuxt/ui',
          'dist-tags': { latest: '3.0.0' },
          'versions': {
            '2.5.0': {
              dependencies: {
                nuxt: '^3.0.0',
              },
            },
            '3.0.0': {
              dependencies: {
                nuxt: '^3.0.0',
              },
            },
          },
        })
      }
      return Promise.resolve({})
    })

    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui@2.5.0'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/fake-dir',
        dependencies: ['@nuxt/ui@2.5.0'],
      }),
    )
  })

  it('should add the resolved module to the config', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
      },
    })

    expect(readNuxtConfig).toHaveBeenCalledWith('/fake-dir')
    expect(addNuxtConfigEntries).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/fake-dir/nuxt.config.ts' }),
      { modules: ['@nuxt/ui'] },
    )
  })

  it('should run prepare command after installation', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
      },
    })

    expect(runCommands.runCommandDef).toHaveBeenCalled()
  })

  it('should not update nuxt.config when the install fails', async () => {
    runInstall.mockResolvedValue({ success: false, output: '', command: 'npm install @nuxt/ui@3.0.0', error: '`npm` was not found.', missingPackageManager: true, ignoredBuilds: [] })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
      },
    })

    expect(runInstall).toHaveBeenCalledWith(
      expect.objectContaining({ packageManager: { name: 'npm', command: 'npm' } }),
    )
    expect(addNuxtConfigEntries).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)

    exit.mockRestore()
  })

  it('should not run prepare command when skipInstall is true', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
        skipInstall: true,
      },
    })

    expect(runCommands.runCommandDef).not.toHaveBeenCalled()
  })
})
