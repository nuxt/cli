import { defineCommand } from 'citty'
import { describe, expect, it, vi } from 'vitest'

import { runCommandDef } from '../../src/run-command'

let clear: boolean | undefined

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

  it('should not modify a `--cwd` it normalises', async () => {
    const { runCommand } = await import('../../src/run')
    const argv = ['--clear', '--cwd', '.']

    await runCommand('dev', argv)
    await runCommandDef(devCommand, argv)

    expect(argv).toEqual(['--clear', '--cwd', '.'])
  })

  it('should reject inherited command properties', async () => {
    const { runCommand } = await import('../../src/run')

    await expect(runCommand('toString', [])).rejects.toThrow('Invalid command toString')
  })
})
