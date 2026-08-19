import { defineCommand } from 'citty'
import { describe, expect, it, vi } from 'vitest'

import { runCommandDef } from '../../src/run-command'

let clear: boolean | undefined
let cwd: string | undefined

const devCommand = defineCommand({
  meta: { name: 'dev' },
  args: {
    clear: {
      type: 'boolean',
      description: 'Clear console on restart',
      default: false,
    },
  },
  run(ctx) {
    clear = ctx.args.clear
    cwd = ctx.args.cwd as string | undefined
  },
})

vi.mock('../../src/commands', () => ({
  commands: {
    dev: () => Promise.resolve(devCommand),
  },
}))

describe('runCommand', () => {
  it('should not clear the console unless asked to', async () => {
    const { runCommand } = await import('../../src/run')

    await runCommand('dev', [])
    expect(clear).toBe(false)

    await runCommandDef(devCommand, [])
    expect(clear).toBe(false)
  })

  it('should respect an explicit `--clear`', async () => {
    const { runCommand } = await import('../../src/run')

    await runCommand('dev', ['--clear'])
    expect(clear).toBe(true)

    await runCommandDef(devCommand, ['--clear'])
    expect(clear).toBe(true)
  })

  it('should not modify the arguments it is given', async () => {
    const { runCommand } = await import('../../src/run')
    const argv = ['--clear']

    await runCommand('dev', argv)
    await runCommandDef(devCommand, argv)

    expect(argv).toEqual(['--clear'])
  })

  it('should parse a `--cwd` the command does not declare', async () => {
    const { runCommand } = await import('../../src/run')
    const argv = ['--clear', '--cwd', 'apps/web']

    await runCommand('dev', argv)
    expect(cwd).toBe('apps/web')

    await runCommandDef(devCommand, argv)
    expect(cwd).toBe('apps/web')

    expect(argv).toEqual(['--clear', '--cwd', 'apps/web'])
  })

  it('should reject inherited command properties', async () => {
    const { runCommand } = await import('../../src/run')

    await expect(runCommand('toString', [])).rejects.toThrow('Invalid command toString')
  })
})
