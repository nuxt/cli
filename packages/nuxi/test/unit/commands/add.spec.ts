import { beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../src/commands/module'
import * as utils from '../../../src/commands/module/_utils'
import * as runCommands from '../../../src/run'
import * as versions from '../../../src/utils/versions'

const { updateConfig, addDependency, detectPackageManager, mock$fetch } = vi.hoisted(() => {
  return {
    updateConfig: vi.fn(() => Promise.resolve()),
    addDependency: vi.fn(() => Promise.resolve()),
    detectPackageManager: vi.fn(() => Promise.resolve({ name: 'npm' })),
    mock$fetch: vi.fn(),
  }
})

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
      return Promise.resolve({
        devDependencies: {
          nuxt: '3.14.0',
        },
      })
    },
  }
})

vi.mock('ofetch', async () => {
  return {
    $fetch: mock$fetch,
  }
})

interface CommandsType {
  subCommands: {
    add: () => Promise<{ setup: (args: any) => void }>
  }
}

describe('nuxt add command', () => {
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

    vi.spyOn(runCommands, 'runCommand').mockImplementation(vi.fn())
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

    expect(addDependency).toHaveBeenCalledWith(
      ['@nuxt/ui@3.0.0'],
      {
        cwd: '/fake-dir',
        dev: true,
        installPeerDependencies: true,
        packageManager: { name: 'npm' },
        workspace: false,
      },
    )

    expect(updateConfig).toHaveBeenCalled()
  })

  it('should install a module by npm package name', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['@nuxt/icon'],
      },
    })

    expect(addDependency).toHaveBeenCalledWith(
      ['@nuxt/icon@1.0.0'],
      {
        cwd: '/fake-dir',
        dev: true,
        installPeerDependencies: true,
        packageManager: { name: 'npm' },
        workspace: false,
      },
    )
  })

  it('should install multiple modules', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui', 'icon'],
      },
    })

    expect(addDependency).toHaveBeenCalledWith(
      ['@nuxt/ui@3.0.0', '@nuxt/icon@1.0.0'],
      {
        cwd: '/fake-dir',
        dev: true,
        installPeerDependencies: true,
        packageManager: { name: 'npm' },
        workspace: false,
      },
    )
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

    expect(addDependency).not.toHaveBeenCalled()
    expect(updateConfig).toHaveBeenCalled()
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

    expect(addDependency).toHaveBeenCalled()
    expect(updateConfig).not.toHaveBeenCalled()
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

    expect(addDependency).toHaveBeenCalledWith(
      ['@nuxt/ui@3.0.0'],
      expect.objectContaining({
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

    expect(addDependency).toHaveBeenCalledWith(
      ['@nuxt/ui@2.5.0'],
      expect.objectContaining({
        cwd: '/fake-dir',
      }),
    )
  })

  it('should call updateConfig when adding modules', async () => {
    const addCommand = await (commands as CommandsType).subCommands.add()

    await addCommand.setup({
      args: {
        cwd: '/fake-dir',
        _: ['ui'],
      },
    })

    // Verify that updateConfig was called
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/fake-dir',
        configFile: 'nuxt.config',
      }),
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

    expect(runCommands.runCommand).toHaveBeenCalled()
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

    expect(runCommands.runCommand).not.toHaveBeenCalled()
  })
})
