import type { TestFunction } from 'vitest'
import type { commands } from '../../src/commands'

import { existsSync } from 'node:fs'

import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { isWindows } from 'std-env'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'
import { fetchWithPolling } from '../utils'

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

describe('commands', () => {
  const tests: Record<keyof typeof commands, 'todo' | TestFunction<object>> = {
    '_dev': 'todo',
    'add': 'todo',
    'add-template': async () => {
      const file = join(fixtureDir, 'server/api/test.ts')
      await rm(file, { force: true })
      await x(nuxi, ['add', 'api', 'test'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(existsSync(file)).toBeTruthy()
      await rm(file, { force: true })
    },
    'analyze': 'todo',
    'build': async () => {
      const res = await x(nuxi, ['build'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
      expect(existsSync(join(fixtureDir, '.output'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, '.output/server'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, '.output/public'))).toBeTruthy()
    },
    'cleanup': async () => {
      const res = await x(nuxi, ['cleanup'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
    },
    'curl': 'todo',
    'devtools': 'todo',
    'module': 'todo',
    'prepare': async () => {
      const res = await x(nuxi, ['prepare'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
      expect(existsSync(join(fixtureDir, '.nuxt'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, '.nuxt/types'))).toBeTruthy()
    },
    'preview': async () => {
      await x(nuxi, ['build'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      const port = await getPort({ host: '127.0.0.1', port: 3002 })
      const previewProcess = x(nuxi, ['preview', `--host=127.0.0.1`, `--port=${port}`], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      // Test that server responds
      const response = await fetchWithPolling(`http://127.0.0.1:${port}`)
      expect.soft(response?.status).toBe(200)

      previewProcess.kill()
    },
    'start': 'todo',
    'test': 'todo',
    'typecheck': async () => {
      const res = await x(nuxi, ['typecheck'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
    },
    'upgrade': 'todo',
    'dev': async () => {
      const controller = new AbortController()
      const port = await getPort({ host: '127.0.0.1', port: 3001 })
      const devProcess = x(nuxi, ['dev', `--host=127.0.0.1`, `--port=${port}`], {
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
        signal: controller.signal,
      })

      // Test that server responds
      const response = await fetchWithPolling(`http://127.0.0.1:${port}`, {}, 30, 300)
      expect.soft(response?.status).toBe(200)

      controller.abort()
      try {
        await devProcess
      }
      catch {}
    },
    'generate': async () => {
      const res = await x(nuxi, ['generate'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
      expect(existsSync(join(fixtureDir, 'dist'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, 'dist/index.html'))).toBeTruthy()
    },
    'init': async () => {
      const res = await x(nuxi, ['init', 'my-app'], {
        throwOnError: false,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      expect(res.exitCode).toBe(1)
      expect(res.stdout + res.stderr).toContain('create nuxt@latest my-app')
    },
    'info': 'todo',
  }

  it('throws error if no command is provided', async () => {
    const res = await x(nuxi, [], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] No command specified.\n')
  })

  // TODO: on Windows tinyexec falls back to `cmd.exe`, which reports the missing binary itself rather than surfacing ENOENT
  it.skipIf(isWindows)('throws error if wrong command is provided', async () => {
    const res = await x(nuxi, ['foo'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] Unknown command foo\n')
  })

  it.skipIf(isWindows)('rejects command names inherited from Object.prototype', async () => {
    const res = await x(nuxi, ['toString'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] Unknown command toString\n')
  })

  it.skipIf(isWindows)('forwards the exit status of a local command', async () => {
    const binDir = join(fixtureDir, 'node_modules/.bin')
    const bin = join(binDir, 'nuxt-exit-test')
    await mkdir(binDir, { recursive: true })
    await writeFile(bin, '#!/bin/sh\nexit 42\n')
    await chmod(bin, 0o755)

    try {
      const res = await x(nuxi, ['exit-test'], {
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(42)
    }
    finally {
      await rm(bin, { force: true })
    }
  })

  const testsToRun = Object.entries(tests).filter(([_, value]) => value !== 'todo')
  it.each(testsToRun)(`%s`, { timeout: isWindows ? 200000 : 50000 }, (_, test) => (test as () => Promise<void>)())

  for (const [command, value] of Object.entries(tests)) {
    if (value === 'todo') {
      it.todo(command)
    }
  }
})

describe('extends support', () => {
  it('works with dev server', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const controller = new AbortController()
    const port = await getPort({ host: '127.0.0.1', port: 3003 })
    const devProcess = x(nuxi, ['dev', `--host=127.0.0.1`, `--port=${port}`, '--extends=some-layer'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      signal: controller.signal,
    })

    // Test that server responds
    const response = await fetchWithPolling(`http://127.0.0.1:${port}/extended`, {}, 30, 300)
    expect.soft(response?.status).toBe(200)
    expect(await response?.text()).toContain('This is an extended page from a layer.')

    controller.abort()
    try {
      await devProcess
    }
    catch {}
  })
})
