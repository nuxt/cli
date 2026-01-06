import { existsSync, promises as fsp } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import addCommand from '../../../src/commands/add'
import addModuleCommand from '../../../src/commands/module/add'
import * as runCommands from '../../../src/run'

vi.mock('../../../src/run', () => ({
  runCommand: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: vi.fn(() => Promise.resolve({
    loadNuxtConfig: vi.fn(() => Promise.resolve({
      srcDir: '/fake-dir',
      dir: { pages: 'pages' },
    })),
  })),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    promises: {
      ...actual.promises,
      mkdir: vi.fn(() => Promise.resolve()),
      writeFile: vi.fn(() => Promise.resolve()),
    },
  }
})

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
}))

describe('add command - module mode', () => {
  it('should delegate to module add command when first arg is not a template', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/content',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['@nuxt/content'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/content', '--cwd=/fake-dir']),
    )
  })

  it('should delegate to module add command when template name has no associated name', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    // 'page' is a valid template name, but without a name argument it should go to module mode
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'page',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['page'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['page', '--cwd=/fake-dir']),
    )
  })

  it('should pass skipInstall flag to module add command', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: true,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['@nuxt/ui'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/ui', '--cwd=/fake-dir', '--skipInstall']),
    )
  })

  it('should pass skipConfig flag to module add command', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: true,
        dev: false,
        logLevel: '',
        _: ['@nuxt/ui'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/ui', '--cwd=/fake-dir', '--skipConfig']),
    )
  })

  it('should pass dev flag to module add command', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: true,
        logLevel: '',
        _: ['@nuxt/ui'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/ui', '--cwd=/fake-dir', '--dev']),
    )
  })

  it('should pass logLevel flag to module add command', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: 'verbose',
        _: ['@nuxt/ui'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/ui', '--cwd=/fake-dir', '--logLevel=verbose']),
    )
  })

  it('should pass multiple modules to module add command', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['@nuxt/ui', '@nuxt/content', '@nuxtjs/i18n'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/ui', '@nuxt/content', '@nuxtjs/i18n', '--cwd=/fake-dir']),
    )
  })

  it('should pass all flags together to module add command', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: true,
        skipConfig: true,
        dev: true,
        logLevel: 'debug',
        _: ['@nuxt/ui'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining([
        '@nuxt/ui',
        '--cwd=/fake-dir',
        '--skipInstall',
        '--skipConfig',
        '--dev',
        '--logLevel=debug',
      ]),
    )
  })

  it('should filter empty module names', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: '@nuxt/ui',
        name: '',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['@nuxt/ui', '', '  ', '@nuxt/content'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).toHaveBeenCalledWith(
      addModuleCommand,
      expect.arrayContaining(['@nuxt/ui', '@nuxt/content', '--cwd=/fake-dir']),
    )
    // Should not contain empty strings
    const callArgs = runCommandSpy.mock.calls[0]![1]
    expect(callArgs).not.toContain('')
    expect(callArgs).not.toContain('  ')
  })
})

describe('add command - template mode (backward compatibility)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
  })

  it('should create a component template when template name and name are provided', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/components/MyButton.vue',
      expect.stringContaining('Component: MyButton'),
    )
  })

  it('should create a page template when template name and name are provided', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'page',
        name: 'about',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['page', 'about'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/pages/about.vue',
      expect.stringContaining('Page: about'),
    )
  })

  it('should create a composable template when template name and name are provided', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'composable',
        name: 'useCounter',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['composable', 'useCounter'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/composables/useCounter.ts',
      expect.stringContaining('useCounter'),
    )
  })

  it('should create parent directory if it does not exist', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.mkdir).toHaveBeenCalledWith('/fake-dir/components', { recursive: true })
  })

  it('should not create parent directory if it already exists', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      // Parent directory exists
      return path === '/fake-dir/components'
    })

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.mkdir).not.toHaveBeenCalled()
  })

  it('should exit with error if file already exists without --force flag', async () => {
    vi.mocked(existsSync).mockReturnValue(true)

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton'],
      },
      rawArgs: [],
      cmd: addCommand,
    })).rejects.toThrow('process.exit called')

    expect(mockExit).toHaveBeenCalledWith(1)
    expect(fsp.writeFile).not.toHaveBeenCalled()

    mockExit.mockRestore()
  })

  it('should overwrite file if it already exists with --force flag', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      // File exists but force is true
      return path === '/fake-dir/components/MyButton.vue'
    })

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton',
        force: true,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/components/MyButton.vue',
      expect.stringContaining('Component: MyButton'),
    )
  })

  it('should strip .vue extension from name', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton.vue',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton.vue'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/components/MyButton.vue',
      expect.stringContaining('Component: MyButton'),
    )
  })

  it('should strip .ts extension from name for composables', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'composable',
        name: 'useCounter.ts',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['composable', 'useCounter.ts'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/composables/useCounter.ts',
      expect.stringContaining('useCounter'),
    )
  })

  it('should handle nested component paths', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'ui/Button',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'ui/Button'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/components/ui/Button.vue',
      expect.stringContaining('Component: ui/Button'),
    )
  })

  it('should handle nested page paths', async () => {
    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'page',
        name: 'users/[id]',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['page', 'users/[id]'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(fsp.writeFile).toHaveBeenCalledWith(
      '/fake-dir/pages/users/[id].vue',
      expect.stringContaining('Page: users/[id]'),
    )
  })

  it('should not delegate to module add when both template and name are provided', async () => {
    const runCommandSpy = vi.spyOn(runCommands, 'runCommand')

    await addCommand.run!({
      args: {
        cwd: '/fake-dir',
        template_or_module: 'component',
        name: 'MyButton',
        force: false,
        skipInstall: false,
        skipConfig: false,
        dev: false,
        logLevel: '',
        _: ['component', 'MyButton'],
      },
      rawArgs: [],
      cmd: addCommand,
    })

    expect(runCommandSpy).not.toHaveBeenCalledWith(addModuleCommand, expect.anything())
    expect(fsp.writeFile).toHaveBeenCalled()
  })
})
