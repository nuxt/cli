import type { CommandDef } from 'citty'

import process from 'node:process'

import { consola } from 'consola'
import { describe, expect, it, vi } from 'vitest'

import { withRemedy } from '../../src/commands'
import { ActionableError } from '../../src/utils/errors'
import { setRunningMain } from '../../src/utils/running-main'

function tagged(): Error {
  return Object.assign(new Error('The module `@nuxt/image` could not be loaded. It may not be installed.'), {
    code: 'NUXT_B8017',
    fix: 'Run `npm install @nuxt/image` to install it.',
  })
}

function run(command: CommandDef): Promise<unknown> {
  return (command.run as (context: unknown) => Promise<unknown>)({ args: {}, cmd: command, rawArgs: [] })
}

/** Resolve a command's subcommand map however it was declared, as citty does. */
async function resolveMap(command: CommandDef): Promise<Record<string, unknown>> {
  const { subCommands } = command
  return await (typeof subCommands === 'function'
    ? subCommands()
    : subCommands) as Record<string, unknown>
}

async function subCommand(command: CommandDef, name: string): Promise<CommandDef> {
  const entry = (await resolveMap(command))[name]
  return await (typeof entry === 'function'
    ? entry()
    : entry) as CommandDef
}

describe('command error boundary', () => {
  it('should present a tagged error by its remedy however far into the command it was raised', async () => {
    const command = withRemedy({
      meta: { name: 'build' },
      run: async () => {
        await Promise.resolve()
        throw tagged()
      },
    })

    await expect(run(command)).rejects.toThrow(ActionableError)
    await expect(run(command)).rejects.toThrow(/Run `npm install @nuxt\/image` to install it\./)
  })

  it('should leave an untagged error with its stack', async () => {
    const parse = new Error('ParseError: Unexpected token')
    const command = withRemedy({
      meta: { name: 'build' },
      run: () => Promise.reject(parse),
    })

    await expect(run(command)).rejects.toBe(parse)
  })

  it('should reject without exiting when a reported diagnostic reaches a programmatic caller', async () => {
    const error = Object.assign(new Error('2 routes failed to prerender.'), { code: 'NUXT_B1024' })
    Object.defineProperty(error, Symbol.for('nuxt.diagnostic.reported'), { value: true })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const command = withRemedy({
      meta: { name: 'build' },
      run: () => Promise.reject(error),
    })

    try {
      await expect(run(command)).rejects.toBe(error)
      expect(exit).not.toHaveBeenCalled()
    }
    finally {
      exit.mockRestore()
    }
  })

  it('should exit without rethrowing a reported diagnostic when the CLI entry runs it', async () => {
    const error = Object.assign(new Error('2 routes failed to prerender.'), { code: 'NUXT_B1024' })
    Object.defineProperty(error, Symbol.for('nuxt.diagnostic.reported'), { value: true })
    setRunningMain(true)
    const exited = new Error('process.exit')
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exited
    })
    const command = withRemedy({
      meta: { name: 'build' },
      run: () => Promise.reject(error),
    })

    try {
      await expect(run(command)).rejects.toBe(exited)
      expect(exit).toHaveBeenCalledWith(1)
    }
    finally {
      setRunningMain(false)
      exit.mockRestore()
    }
  })

  it('should report a failed command through consola after the console was unwrapped', async () => {
    consola.restoreConsole()
    const original = console.error
    const command = withRemedy({
      meta: { name: 'build' },
      run: () => Promise.reject(new Error('build failed')),
    })

    try {
      await expect(run(command)).rejects.toThrow('build failed')
      expect(console.error).not.toBe(original)
    }
    finally {
      consola.restoreConsole()
    }
  })

  it('should carry the boundary into subcommands', async () => {
    const command = withRemedy({
      meta: { name: 'module' },
      subCommands: {
        add: () => ({
          meta: { name: 'add' },
          run: () => Promise.reject(tagged()),
        }),
      },
    })

    await expect(run(await subCommand(command, 'add'))).rejects.toThrow(ActionableError)
  })

  it('should keep the subcommands of a command whose whole map is a resolver', async () => {
    const command = withRemedy({
      meta: { name: 'module' },
      subCommands: () => ({
        add: {
          meta: { name: 'add' },
          run: () => Promise.reject(tagged()),
        },
      }),
    })

    expect(Object.keys(await resolveMap(command))).toEqual(['add'])
    await expect(run(await subCommand(command, 'add'))).rejects.toThrow(ActionableError)
  })

  it('should keep the subcommands of a command whose map is a promise', async () => {
    const command = withRemedy({
      meta: { name: 'task' },
      subCommands: Promise.resolve({
        run: {
          meta: { name: 'run' },
          run: () => Promise.reject(tagged()),
        },
      }),
    })

    expect(Object.keys(await resolveMap(command))).toEqual(['run'])
    await expect(run(await subCommand(command, 'run'))).rejects.toThrow(ActionableError)
  })

  it('should leave a plain subcommand map as a plain object', async () => {
    const command = withRemedy({
      meta: { name: 'module' },
      subCommands: {
        add: {
          meta: { name: 'add' },
          run: () => Promise.resolve('ok'),
        },
      },
    })

    expect(typeof command.subCommands).toBe('object')
    await expect(run(await subCommand(command, 'add'))).resolves.toBe('ok')
  })

  it('should pass a resolved command through untouched when it cannot fail', async () => {
    const command = withRemedy({
      meta: { name: 'info' },
      run: () => Promise.resolve('ok'),
    })

    await expect(run(command)).resolves.toBe('ok')
  })
})
