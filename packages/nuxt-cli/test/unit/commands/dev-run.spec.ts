import type { TakeoverOptions, TakeoverResult } from '../../../src/dev/takeover'
import type { LockInfo } from '../../../src/utils/lockfile'

import process from 'node:process'

import { runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  close,
  createFork,
  getFork,
  initialize,
  onFileChange,
  onReady,
  onRestart,
  isReusePortSupported,
  preflight,
  setupShortcuts,
  startWarming,
  takeOverDevServer,
} = vi.hoisted(() => ({
  close: vi.fn(() => Promise.resolve()),
  createFork: vi.fn(),
  getFork: vi.fn(),
  initialize: vi.fn(),
  isReusePortSupported: vi.fn(() => Promise.resolve(true)),
  onFileChange: vi.fn(),
  onReady: vi.fn(),
  onRestart: vi.fn(),
  preflight: vi.fn((options: { cwd: string }) => Promise.resolve(options.cwd)),
  setupShortcuts: vi.fn(),
  startWarming: vi.fn(),
  takeOverDevServer: vi.fn<(buildDir: string, options?: TakeoverOptions) => Promise<TakeoverResult>>(() => Promise.resolve({ action: 'none' })),
}))

vi.mock('../../../src/dev/index', () => ({ initialize }))
// Whether a restart hands over or is serialised depends on `SO_REUSEPORT`, which
// Linux has and macOS and Windows do not, so the probe is stubbed rather than left
// to whichever platform the suite runs on.
vi.mock('../../../src/dev/listen', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/dev/listen')>(),
  isReusePortSupported,
}))
vi.mock('../../../src/dev/preflight', () => ({ preflight }))
vi.mock('../../../src/dev/shortcuts', () => ({ setupShortcuts }))
vi.mock('../../../src/utils/dev-server', () => ({ resolveLockDir: (cwd: string) => Promise.resolve(`${cwd}/.nuxt`) }))
vi.mock('../../../src/dev/takeover', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/dev/takeover')>(),
  takeOverDevServer,
}))
vi.mock('../../../src/dev/pool', () => ({
  ForkPool: class {
    constructor(options: unknown) {
      createFork(options)
    }

    startWarming = startWarming
    getFork = getFork
    killAll = vi.fn()
  },
}))

const dev = await import('../../../src/commands/dev').then(r => r.default)

const listener = {
  address: { address: '127.0.0.1', port: 3000 },
  url: 'http://127.0.0.1:3000',
  close: () => Promise.resolve(),
}

function existingLock(overrides: Partial<LockInfo> = {}): LockInfo {
  return {
    pid: 4321,
    startedAt: Date.now(),
    command: 'dev',
    cwd: process.cwd(),
    interactive: false,
    port: 3000,
    url: 'http://localhost:3000',
    ...overrides,
  }
}

async function runDev(args: string[] = []) {
  return await runCommand(dev, { rawArgs: [`--cwd=${process.cwd()}`, ...args] })
}

let exit: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  takeOverDevServer.mockResolvedValue({ action: 'none' })
  isReusePortSupported.mockResolvedValue(true)
  preflight.mockImplementation((options: { cwd: string }) => Promise.resolve(options.cwd))
  initialize.mockImplementation(() => Promise.resolve({
    listener,
    close,
    onRestart,
    onReady,
    onFileChange,
    reload: vi.fn(),
    onLoading: vi.fn(),
    onEachReady: vi.fn(),
    onLog: vi.fn(),
    onRequests: vi.fn(),
    onRoutes: vi.fn(),
    onBuilding: vi.fn(),
    onReport: vi.fn(),
    onReportClear: vi.fn(),
  }))
  exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit')
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('dev command startup', () => {
  it('should start the server in this process when forking is disabled', async () => {
    await runDev(['--no-fork'])

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(createFork).not.toHaveBeenCalled()
    expect(setupShortcuts).toHaveBeenCalledTimes(1)
  })

  it('should pass the requested port through to the listener', async () => {
    await runDev(['--no-fork', '--port=4000'])

    expect(initialize.mock.calls[0]![1].listenOverrides).toMatchObject({ port: '4000' })
  })

  it('should keep the port unresolved when none was requested', async () => {
    await runDev(['--no-fork'])

    expect(initialize.mock.calls[0]![1].listenOverrides.port).toBeUndefined()
  })

  it('should carry `--strictPort` into the listen options', async () => {
    await runDev(['--no-fork', '--port=4000', '--strictPort'])

    expect(initialize.mock.calls[0]![1].listenOverrides).toMatchObject({ port: '4000', strictPort: true })
  })

  it('should reject a port that is not a number before starting anything', async () => {
    await expect(runDev(['--no-fork', '--port=notaport'])).rejects.toThrow('Invalid port')

    expect(initialize).not.toHaveBeenCalled()
  })

  it('should let a bind failure surface to the caller', async () => {
    initialize.mockImplementation(() => Promise.reject(new Error('Port 4000 is already in use (`--strictPort` is enabled).')))

    await expect(runDev(['--no-fork', '--port=4000', '--strictPort'])).rejects.toThrow('already in use')
  })

  it('should not run the profiler and the fork pool together', async () => {
    await runDev(['--fork', '--profile'])

    expect(createFork).not.toHaveBeenCalled()
  })

  it('should treat a valued `--profile` the same way', async () => {
    await runDev(['--fork', '--profile=verbose'])

    expect(createFork).not.toHaveBeenCalled()
  })
})

describe('dev command takeover', () => {
  it('should not start when a takeover is refused', async () => {
    takeOverDevServer.mockResolvedValue({ action: 'refused', existing: existingLock(), reason: 'declined' })

    await expect(runDev(['--no-fork'])).rejects.toThrow('process.exit')

    expect(exit).toHaveBeenCalledWith(1)
    expect(initialize).not.toHaveBeenCalled()
  })

  it('should adopt the port of the server it took over', async () => {
    takeOverDevServer.mockResolvedValue({ action: 'taken', port: 3210, pid: 4321 })

    await runDev(['--no-fork'])

    const [context, options] = initialize.mock.calls[0]!
    expect(options.listenOverrides).toMatchObject({ port: 3210 })
    expect(context.handoverFrom).toBe(4321)
  })

  it('should ask the takeover for the port it was given', async () => {
    await runDev(['--no-fork', '--port=4001'])

    expect(vi.mocked(takeOverDevServer).mock.calls[0]![1]).toMatchObject({ requestedPort: 4001 })
  })

  it('should bypass the lock when the user starts a second server anyway', async () => {
    takeOverDevServer.mockResolvedValue({ action: 'start-anyway', existing: existingLock() })
    vi.stubEnv('NUXT_IGNORE_LOCK', '')

    await runDev(['--no-fork'])

    expect(process.env.NUXT_IGNORE_LOCK).toBe('1')
  })

  it('should not pass a handover pid when nothing was taken over', async () => {
    await runDev(['--no-fork'])

    expect(initialize.mock.calls[0]![0].handoverFrom).toBeUndefined()
  })
})

describe('dev command fork pool', () => {
  it('should warm the pool only once a file changes', async () => {
    await runDev(['--fork'])

    expect(createFork).toHaveBeenCalledTimes(1)
    expect(startWarming).not.toHaveBeenCalled()

    onFileChange.mock.calls[0]![0]()
    expect(startWarming).toHaveBeenCalledTimes(1)
  })

  it('should hand the pool the arguments the session was started with', async () => {
    await runDev(['--fork', '--port=4002'])

    expect(createFork.mock.calls[0]![0]).toMatchObject({ listenOverrides: expect.objectContaining({ port: '4002' }) })
  })

  it('should replace the current server with a fork on a hard restart', async () => {
    const forkClose = vi.fn(() => Promise.resolve())
    getFork.mockResolvedValue({ pid: 999, serving: Promise.resolve(), promote: vi.fn(), close: forkClose })
    await runDev(['--fork'])

    await onRestart.mock.calls[0]![0]({ type: 'shortcut' })

    expect(getFork).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('should keep the current server when the incoming fork cannot serve', async () => {
    const forkClose = vi.fn(() => Promise.resolve())
    const serving = Promise.reject(new Error('fork died'))
    serving.catch(() => {})
    getFork.mockResolvedValue({ pid: 999, serving, promote: vi.fn(), close: forkClose })
    await runDev(['--fork'])

    await onRestart.mock.calls[0]![0]({ type: 'shortcut' })

    expect(forkClose).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('should exit when a serialised restart leaves nothing serving the app', async () => {
    isReusePortSupported.mockResolvedValue(false)
    const forkClose = vi.fn(() => Promise.resolve())
    const serving = Promise.reject(new Error('fork died'))
    serving.catch(() => {})
    getFork.mockResolvedValue({ pid: 999, serving, promote: vi.fn(), close: forkClose })
    await runDev(['--fork'])

    await expect(onRestart.mock.calls[0]![0]({ type: 'shortcut' })).rejects.toThrow('process.exit')

    expect(close).toHaveBeenCalledTimes(1)
    expect(forkClose).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('should collapse overlapping hard restarts into one handover at a time', async () => {
    let releaseFirst: (() => void) | undefined
    getFork.mockImplementation(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ pid: 999, serving: Promise.resolve(), promote: vi.fn(), close: vi.fn(() => Promise.resolve()) })
    }))
    await runDev(['--fork'])

    const restart = onRestart.mock.calls[0]![0]
    const first = restart({ type: 'shortcut' })
    const second = restart({ type: 'shortcut' })
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))
    releaseFirst!()
    await Promise.all([first, second])

    expect(getFork).toHaveBeenCalledTimes(2)
  })
})
