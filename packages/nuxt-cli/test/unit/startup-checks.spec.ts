import type { CommandContext } from 'citty'
import type { main } from '../../src/main'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkEngines = vi.hoisted(() => vi.fn(async () => {}))
const scheduleUpdateNudge = vi.hoisted(() => vi.fn(async () => {}))

async function setup(argv: string[]): Promise<void> {
  vi.doMock('../../src/utils/engines', () => ({ checkEngines }))
  vi.doMock('../../src/utils/update-lazy', () => ({ scheduleUpdateNudge }))
  vi.doMock('../../src/commands', () => ({
    commands: { info: () => ({ meta: { name: 'info' }, args: {}, run: () => {} }) },
  }))
  vi.resetModules()

  const { main: freshMain } = await import('../../src/main') as { main: typeof main }
  const command = argv.find(arg => !arg.startsWith('-'))
  await freshMain.setup!({
    rawArgs: argv,
    args: { _: command ? [command] : [], cwd: '.' },
    cmd: freshMain,
    data: {},
  } as unknown as CommandContext)

  await new Promise(resolve => setImmediate(resolve))
}

describe('startup checks', () => {
  beforeEach(() => {
    checkEngines.mockClear()
    scheduleUpdateNudge.mockClear()
  })

  it('should run for a command', async () => {
    await setup(['info'])

    expect(checkEngines).toHaveBeenCalled()
    await vi.waitFor(() => expect(scheduleUpdateNudge).toHaveBeenCalled())
  })

  it('should be skipped when no command is given', async () => {
    await setup(['--version'])

    expect(checkEngines).not.toHaveBeenCalled()
    expect(scheduleUpdateNudge).not.toHaveBeenCalled()
  })
})
