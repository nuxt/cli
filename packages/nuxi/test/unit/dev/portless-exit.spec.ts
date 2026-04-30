import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerPortlessExitCleanup } from '../../../src/dev/portless'

const { spawnSync } = vi.hoisted(() => {
  return {
    spawnSync: vi.fn(),
  }
})

vi.mock('node:child_process', () => {
  return {
    spawnSync,
  }
})

describe('registerPortlessExitCleanup', () => {
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    spawnSync.mockReset()
    stderrWrite.mockClear()
  })

  it('removes the alias on process exit', () => {
    spawnSync.mockReturnValue({ status: 0, stderr: '', error: undefined })
    const existingListeners = new Set(process.listeners('exit'))
    const dispose = registerPortlessExitCleanup('/tmp/fixtures-dev', 'fixtures-dev')
    const cleanup = process.listeners('exit').find(listener => !existingListeners.has(listener))

    expect(cleanup).toBeTypeOf('function')

    cleanup?.(0)

    expect(spawnSync).toHaveBeenCalledWith('portless', ['alias', '--remove', 'fixtures-dev'], {
      cwd: '/tmp/fixtures-dev',
      encoding: 'utf8',
      stdio: 'pipe',
    })
    expect(stderrWrite).not.toHaveBeenCalled()

    dispose()
  })

  it('does nothing after the cleanup is disposed', () => {
    const existingListeners = new Set(process.listeners('exit'))
    const dispose = registerPortlessExitCleanup('/tmp/fixtures-dev', 'fixtures-dev')
    const cleanup = process.listeners('exit').find(listener => !existingListeners.has(listener))

    dispose()
    cleanup?.(0)

    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('reports cleanup failures on process exit', () => {
    spawnSync.mockReturnValue({ status: 1, stderr: 'permission denied\n', error: undefined })
    const existingListeners = new Set(process.listeners('exit'))
    const dispose = registerPortlessExitCleanup('/tmp/fixtures-dev', 'fixtures-dev')
    const cleanup = process.listeners('exit').find(listener => !existingListeners.has(listener))

    cleanup?.(0)

    expect(stderrWrite).toHaveBeenCalledWith(
      'Failed to remove the portless alias for fixtures-dev: permission denied\n',
    )

    dispose()
  })
})
