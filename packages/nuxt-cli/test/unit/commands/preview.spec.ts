import type { LockInfo } from '../../../src/utils/lockfile'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { runCommand } from 'citty'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import preview from '../../../src/commands/preview'
import { previewLockDir, readLock } from '../../../src/utils/lockfile'
import { logger } from '../../../src/utils/logger'

const { checkPort, getPort, loadKit, loadNuxt, x } = vi.hoisted(() => ({
  checkPort: vi.fn<(port: number, host?: string) => Promise<number | false>>(),
  getPort: vi.fn<(options: { port?: number }) => Promise<number>>(),
  loadKit: vi.fn(),
  loadNuxt: vi.fn(),
  x: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({ loadKit }))
vi.mock('tinyexec', () => ({ x }))
vi.mock('get-port-please', () => ({ checkPort, getPort }))

let cwd: string

const HOLDER_PID = 424242
const SERVER_PID = 434343

async function writePreviewLock(info: Partial<LockInfo> = {}) {
  const lockDir = previewLockDir(cwd)
  await mkdir(lockDir, { recursive: true })
  await writeFile(join(lockDir, 'nuxt.lock'), JSON.stringify({
    pid: HOLDER_PID,
    startedAt: Date.now(),
    command: 'preview',
    cwd,
    interactive: false,
    port: 4500,
    url: 'http://localhost:4500',
    serverPid: SERVER_PID,
    ...info,
  }))
}

/** Every process is alive until it is sent `SIGTERM`, which also frees its port. */
function mockProcesses() {
  const signals: Array<[number, string | number | undefined]> = []
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal !== 0 && signal !== undefined) {
      signals.push([pid as number, signal])
      checkPort.mockImplementation(async port => port)
    }
    else if (pid !== process.pid && signals.some(([signalled]) => signalled === pid)) {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    }
    return true as never
  })
  return signals
}

function expectServerPort(port: string | undefined) {
  expect(x).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
    nodeOptions: expect.objectContaining({
      env: expect.objectContaining({ NUXT_PORT: port, NITRO_PORT: port }),
    }),
  }))
}

async function writeNitroJSON(outputDir: string, data: Record<string, unknown> = {}) {
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'nitro.json'), JSON.stringify({
    preset: 'node-server',
    commands: { preview: 'node   ./server/index.mjs' },
    ...data,
  }))
}

describe('preview', () => {
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-preview-test-'))
    loadKit.mockResolvedValue({ loadNuxt })
    loadNuxt.mockImplementation(async (options) => {
      const nuxt = {
        options: { srcDir: cwd },
        hook: vi.fn((name, callback) => {
          if (name === 'nitro:init') {
            callback({ options: { output: { dir: '.output' } } })
          }
        }),
        close: vi.fn(),
      }
      options.overrides.modules[0](undefined, nuxt)
      return nuxt
    })
    x.mockResolvedValue({ exitCode: 0 })
    checkPort.mockImplementation(async port => port)
    getPort.mockImplementation(async ({ port }) => port!)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    await rm(cwd, { recursive: true, force: true })
  })

  it('runs the build preview command with normalized whitespace and listen options', async () => {
    const outputDir = join(cwd, '.output')
    await writeNitroJSON(outputDir)

    await runCommand(preview, {
      rawArgs: [cwd, '--port=4321', '--host=127.0.0.1'],
    })

    expect(x).toHaveBeenCalledWith('node', ['./server/index.mjs'], {
      throwOnError: true,
      nodeOptions: expect.objectContaining({
        cwd: outputDir,
        env: expect.objectContaining({
          NUXT_PORT: '4321',
          NITRO_PORT: '4321',
          NUXT_HOST: '127.0.0.1',
          NITRO_HOST: '127.0.0.1',
        }),
      }),
    })
  })

  it('uses the configured output directory', async () => {
    const outputDir = join(cwd, 'dist', 'server-output')
    await writeNitroJSON(outputDir)
    loadNuxt.mockImplementation(async (options) => {
      const nuxt = {
        options: { srcDir: join(cwd, 'src') },
        hook: vi.fn((name, callback) => {
          if (name === 'nitro:init') {
            callback({ options: { output: { dir: '../dist/server-output' } } })
          }
        }),
        close: vi.fn(),
      }
      options.overrides.modules[0](undefined, nuxt)
      return nuxt
    })

    await runCommand(preview, { rawArgs: [cwd] })

    expect(x).toHaveBeenCalledWith('node', ['./server/index.mjs'], expect.objectContaining({
      nodeOptions: expect.objectContaining({ cwd: outputDir }),
    }))
  })

  it('falls back to the conventional output when Nuxt cannot load', async () => {
    loadKit.mockRejectedValue(new Error('Nuxt is unavailable'))
    const outputDir = join(cwd, '.output')
    await writeNitroJSON(outputDir)

    await runCommand(preview, { rawArgs: [cwd] })

    expect(x).toHaveBeenCalledWith('node', ['./server/index.mjs'], expect.objectContaining({
      nodeOptions: expect.objectContaining({ cwd: outputDir }),
    }))
  })

  it('uses host and port environment variables', async () => {
    vi.stubEnv('NUXT_PORT', '4100')
    vi.stubEnv('NUXT_HOST', 'localhost')
    await writeNitroJSON(join(cwd, '.output'))

    await runCommand(preview, { rawArgs: [cwd] })

    expect(x).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
      nodeOptions: expect.objectContaining({
        env: expect.objectContaining({
          NUXT_PORT: '4100',
          NITRO_PORT: '4100',
          NUXT_HOST: 'localhost',
          NITRO_HOST: 'localhost',
        }),
      }),
    }))
  })

  it('listens on port 3000 when none is given', async () => {
    await writeNitroJSON(join(cwd, '.output'))

    await runCommand(preview, { rawArgs: [cwd] })

    expect(getPort).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }))
    expectServerPort('3000')
  })

  it('leaves the port to preview commands that choose their own', async () => {
    await writeNitroJSON(join(cwd, '.output'), {
      preset: 'cloudflare-module',
      commands: { preview: 'npx wrangler dev' },
    })

    await runCommand(preview, { rawArgs: [cwd] })

    expect(getPort).not.toHaveBeenCalled()
    expect(x).toHaveBeenCalledWith('npx', ['wrangler', 'dev'], expect.anything())
    expectServerPort(undefined)
  })

  it('moves to another free port when something else holds the one asked for', async () => {
    getPort.mockResolvedValue(4322)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    await writeNitroJSON(join(cwd, '.output'))

    await runCommand(preview, { rawArgs: [cwd, '--port=4321'] })

    expect(warn).toHaveBeenCalledWith('Port 4321 is in use, using port 4322 instead.')
    expectServerPort('4322')
  })

  it('refuses a taken port with `--strictPort`', async () => {
    checkPort.mockResolvedValue(false)
    await writeNitroJSON(join(cwd, '.output'))

    await expect(runCommand(preview, { rawArgs: [cwd, '--port=4321', '--strictPort'] }))
      .rejects
      .toThrow('Port 4321 is already in use (`--strictPort` is enabled).')
    expect(x).not.toHaveBeenCalled()
  })

  it('records the server it starts so a later preview can take it over', async () => {
    let recorded: LockInfo | undefined
    x.mockReturnValue({
      pid: 4242,
      then(resolve: (value: { exitCode: number }) => void) {
        recorded = readLock(previewLockDir(cwd))
        resolve({ exitCode: 0 })
      },
    })
    await writeNitroJSON(join(cwd, '.output'))

    await runCommand(preview, { rawArgs: [cwd, '--port=4321'] })

    expect(recorded).toMatchObject({
      pid: process.pid,
      command: 'preview',
      port: 4321,
      url: 'http://localhost:4321',
      serverPid: 4242,
    })
    expect(readLock(previewLockDir(cwd))).toBeUndefined()
  })

  it.each(['spawn', 'exit'])('releases the lock after a child %s error', async (failure) => {
    const error = new Error('preview failed')
    if (failure === 'spawn') {
      x.mockImplementation(() => {
        throw error
      })
    }
    else {
      x.mockRejectedValue(error)
    }
    await writeNitroJSON(join(cwd, '.output'))
    const listeners = process.listenerCount('exit')

    await expect(runCommand(preview, { rawArgs: [cwd] })).rejects.toThrow(error)

    expect(readLock(previewLockDir(cwd))).toBeUndefined()
    expect(process.listenerCount('exit')).toBe(listeners)
  })

  it('allocates a random port when port zero is requested', async () => {
    getPort.mockResolvedValue(4321)
    await writeNitroJSON(join(cwd, '.output'))

    await runCommand(preview, { rawArgs: [cwd, '--port=0'] })

    expect(getPort).toHaveBeenCalledWith({ random: true, host: undefined })
    expectServerPort('4321')
  })

  it('rejects an invalid port before starting a server', async () => {
    await writeNitroJSON(join(cwd, '.output'))

    await expect(runCommand(preview, { rawArgs: [cwd, '--port=invalid'] }))
      .rejects
      .toThrow('Invalid port')

    expect(x).not.toHaveBeenCalled()
  })

  describe('with a preview of this project already running', () => {
    beforeEach(async () => {
      await writeNitroJSON(join(cwd, '.output'))
      checkPort.mockResolvedValue(false)
    })

    it('takes it over when nobody is watching it, adopting its port', async () => {
      await writePreviewLock()
      const signals = mockProcesses()

      await runCommand(preview, { rawArgs: [cwd] })

      expect(signals).toEqual([[SERVER_PID, 'SIGTERM'], [HOLDER_PID, 'SIGTERM']])
      expectServerPort('4500')
    })

    it('refuses to stop one that someone is watching, saying where it is', async () => {
      await writePreviewLock({ interactive: true })
      const signals = mockProcesses()
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit ${code}`)
      })

      await expect(runCommand(preview, { rawArgs: [cwd] })).rejects.toThrow('exit 1')

      expect(signals).toHaveLength(0)
      expect(x).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Another Nuxt preview server is already running'))
      expect(error).toHaveBeenCalledWith(expect.stringContaining('`--port` to run a second one alongside it'))
    })

    it('takes over one that someone is watching with `--takeover`', async () => {
      await writePreviewLock({ interactive: true })
      const signals = mockProcesses()

      await runCommand(preview, { rawArgs: [cwd, '--takeover'] })

      expect(signals).toEqual([[SERVER_PID, 'SIGTERM'], [HOLDER_PID, 'SIGTERM']])
      expectServerPort('4500')
    })

    it('never stops it with `--no-takeover`', async () => {
      await writePreviewLock()
      const signals = mockProcesses()
      vi.spyOn(logger, 'error').mockImplementation(() => {})
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit ${code}`)
      })

      await expect(runCommand(preview, { rawArgs: [cwd, '--no-takeover'] })).rejects.toThrow('exit 1')
      expect(signals).toHaveLength(0)
    })

    it('starts alongside it on another port asked for', async () => {
      await writePreviewLock()
      const signals = mockProcesses()
      checkPort.mockImplementation(async port => port === 4500 ? false : port)

      await runCommand(preview, { rawArgs: [cwd, '--port=4600'] })

      expect(signals).toHaveLength(0)
      expectServerPort('4600')
      expect(readLock(previewLockDir(cwd))).toMatchObject({ pid: HOLDER_PID })
    })

    it('ignores a dev server of this project', async () => {
      await mkdir(join(cwd, '.nuxt'), { recursive: true })
      await writeFile(join(cwd, '.nuxt', 'nuxt.lock'), JSON.stringify({
        pid: HOLDER_PID,
        startedAt: Date.now(),
        command: 'dev',
        cwd,
        interactive: false,
        port: 3000,
      }))
      const signals = mockProcesses()
      getPort.mockResolvedValue(3001)
      vi.spyOn(logger, 'warn').mockImplementation(() => {})

      await runCommand(preview, { rawArgs: [cwd] })

      expect(signals).toHaveLength(0)
      expectServerPort('3001')
    })
  })
})
