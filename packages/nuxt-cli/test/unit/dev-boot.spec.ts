import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

const paintFirstFrame = vi.fn(() => ({ surface: {}, state: {} }))
const setupDevUI = vi.fn(() => Promise.resolve({}))

vi.mock('../../src/dev/tui/first-frame', () => ({ paintFirstFrame }))
vi.mock('../../src/dev/tui/controller', () => ({ setupDevUI }))

/** Run the entry as if `argv` had been passed, on a terminal unless told otherwise. */
async function boot(argv: string[], terminal = true) {
  const descriptors = {
    argv: Object.getOwnPropertyDescriptor(process, 'argv')!,
    stdout: Object.getOwnPropertyDescriptor(process, 'stdout')!,
    stdin: Object.getOwnPropertyDescriptor(process, 'stdin')!,
  }
  Object.defineProperty(process, 'argv', { value: ['node', 'nuxi', ...argv], configurable: true })
  Object.defineProperty(process, 'stdout', { value: { ...process.stdout, isTTY: terminal }, configurable: true })
  Object.defineProperty(process, 'stdin', { value: { ...process.stdin, isTTY: terminal }, configurable: true })
  try {
    const { bootDevUI } = await import('../../src/boot')
    await bootDevUI()
  }
  finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      Object.defineProperty(process, key, descriptor)
    }
  }
}

describe('dev panel from the cli entry', () => {
  afterEach(() => {
    paintFirstFrame.mockClear()
    setupDevUI.mockClear()
  })

  it('should take the terminal for `nuxt dev`', async () => {
    await boot(['dev'])

    expect(paintFirstFrame).toHaveBeenCalledWith({ cwd: undefined, startTime: undefined })
    expect(setupDevUI).toHaveBeenCalled()
  })

  it('should read the project directory from `--cwd` or the positional', async () => {
    await boot(['dev', '--cwd', 'apps/site'])
    expect(paintFirstFrame).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: 'apps/site' }))

    await boot(['dev', '--cwd=apps/site'])
    expect(paintFirstFrame).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: 'apps/site' }))

    await boot(['dev', 'apps/site', '--port', '3001'])
    expect(paintFirstFrame).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: 'apps/site' }))
  })

  it.each([
    ['another command', ['build']],
    ['help', ['dev', '--help']],
    ['a version check', ['dev', '--version']],
    ['the panel turned off', ['dev', '--no-tui']],
    ['an explicit --tui value', ['dev', '--tui', 'false']],
    ['the inspector', ['dev', '--inspect']],
    ['the profiler', ['dev', '--profile=verbose']],
  ])('should leave %s to the command', async (_case, argv) => {
    await boot(argv)

    expect(paintFirstFrame).not.toHaveBeenCalled()
    expect(setupDevUI).not.toHaveBeenCalled()
  })

  it('should not load the panel when the output is not a terminal', async () => {
    await boot(['dev'], false)

    expect(paintFirstFrame).not.toHaveBeenCalled()
  })

  it('should leave the command to start the session when the terminal refuses the panel', async () => {
    paintFirstFrame.mockReturnValueOnce(undefined as never)

    await boot(['dev'])

    expect(setupDevUI).not.toHaveBeenCalled()
  })
})
