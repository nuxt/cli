import type { ArgsDef } from 'citty'
import type { main } from '../../src/main'

import { runCommand } from 'citty'

import { describe, expect, it, vi } from 'vitest'
import { rootDirArgs } from '../../src/commands/_shared'

async function run(argv: string[], args: ArgsDef = { ...rootDirArgs }): Promise<Record<string, unknown>> {
  const run = vi.fn()
  vi.doMock('../../src/commands', () => ({
    commands: { info: () => ({ meta: { name: 'info' }, args, run }) },
  }))
  vi.resetModules()

  const { main: freshMain } = await import('../../src/main') as { main: typeof main }
  await runCommand(freshMain, { rawArgs: argv })

  return run.mock.calls[0]![0].args
}

describe('global args', () => {
  it('should forward a leading --cwd to the subcommand', async () => {
    expect(await run(['--cwd', 'apps/web', 'info'])).toMatchObject({ cwd: 'apps/web' })
    expect(await run(['--cwd=apps/web', 'info'])).toMatchObject({ cwd: 'apps/web' })
  })

  it('should still accept --cwd after the subcommand', async () => {
    expect(await run(['info', '--cwd', 'apps/web'])).toMatchObject({ cwd: 'apps/web' })
  })

  it('should prefer an explicit --cwd after the subcommand', async () => {
    expect(await run(['--cwd', 'apps/docs', 'info', '--cwd', 'apps/web'])).toMatchObject({ cwd: 'apps/web' })
  })

  it('should forward a leading --cwd to a nested subcommand', async () => {
    const run = vi.fn()
    vi.doMock('../../src/commands', () => ({
      commands: { module: () => ({ meta: { name: 'module' }, subCommands: { add: { meta: { name: 'add' }, args: {}, run } } }) },
    }))
    vi.resetModules()

    const { main: freshMain } = await import('../../src/main') as { main: typeof main }
    await runCommand(freshMain, { rawArgs: ['--cwd', 'apps/web', 'module', 'add', 'nuxt-og-image'] })

    expect(run.mock.calls[0]![0].args).toMatchObject({ cwd: 'apps/web', _: ['nuxt-og-image'] })
  })

  it('should not treat a --cwd after a -- separator as its own', async () => {
    expect((await run(['info', '--', '--cwd', 'apps/web'])).cwd).toBeUndefined()
  })

  it('should preserve the ROOTDIR positional', async () => {
    expect(await run(['--cwd', 'apps/docs', 'info', 'apps/web'])).toMatchObject({ cwd: 'apps/docs', rootDir: 'apps/web' })
    const args = await run(['info', 'apps/web'])
    expect(args).toMatchObject({ rootDir: 'apps/web' })
    expect(args.cwd).toBeUndefined()
  })
})
