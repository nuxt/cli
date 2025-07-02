import type { TestFunction } from 'vitest'
import type { commands } from '../../../nuxi/src/commands'

import { existsSync } from 'node:fs'

import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { isWindows } from 'std-env'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

describe('commands', () => {
  const tests: Record<keyof typeof commands, 'todo' | TestFunction<object>> = {
    _dev: 'todo',
    add: async () => {
      const file = join(fixtureDir, 'server/api/test.ts')
      await rm(file, { force: true })
      await x(nuxi, ['add', 'api', 'test'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(existsSync(file)).toBeTruthy()
      await rm(file, { force: true })
    },
    analyze: 'todo',
    build: async () => {
      const res = await x(nuxi, ['build'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
      expect(existsSync(join(fixtureDir, '.output'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, '.output/server'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, '.output/public'))).toBeTruthy()
    },
    cleanup: async () => {
      const res = await x(nuxi, ['cleanup'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
    },
    devtools: 'todo',
    module: 'todo',
    prepare: async () => {
      const res = await x(nuxi, ['prepare'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
      expect(existsSync(join(fixtureDir, '.nuxt'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, '.nuxt/types'))).toBeTruthy()
    },
    preview: async () => {
      await x(nuxi, ['build'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      const port = await getPort({ host: 'localhost', port: 3002 })
      const previewProcess = x(nuxi, ['preview', `--port=${port}`], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      // Test that server responds
      const response = await fetchWithPolling(`http://localhost:${port}`)
      expect.soft(response.status).toBe(200)

      previewProcess.kill()
    },
    start: 'todo',
    test: 'todo',
    typecheck: async () => {
      const res = await x(nuxi, ['typecheck'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
    },
    upgrade: 'todo',
    dev: async () => {
      const controller = new AbortController()
      const port = await getPort({ host: 'localhost', port: 3001 })
      const devProcess = x(nuxi, ['dev', `--port=${port}`], {
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
        signal: controller.signal,
      })

      // Test that server responds
      const response = await fetchWithPolling(`http://localhost:${port}`, {}, 30, 300)
      expect.soft(response.status).toBe(200)

      controller.abort()
      try {
        await devProcess
      }
      catch {}
    },
    generate: async () => {
      const res = await x(nuxi, ['generate'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(res.exitCode).toBe(0)
      expect(existsSync(join(fixtureDir, 'dist'))).toBeTruthy()
      expect(existsSync(join(fixtureDir, 'dist/index.html'))).toBeTruthy()
    },
    init: async () => {
      const dir = tmpdir()
      const pm = 'pnpm'
      const installPath = join(dir, pm)

      await rm(installPath, { recursive: true, force: true })
      try {
        await x(nuxi, ['init', installPath, `--packageManager=${pm}`, '--gitInit=false', '--preferOffline', '--install=false'], {
          throwOnError: true,
          nodeOptions: { stdio: 'inherit', cwd: fixtureDir },
        })
        const files = await readdir(installPath).catch(() => [])
        expect(files).toContain('nuxt.config.ts')
      }
      finally {
        await rm(installPath, { recursive: true, force: true })
      }
    },
    info: 'todo',
  }

  it('throws error if no command is provided', async () => {
    const res = await x(nuxi, [], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] No command specified.\n')
  })

  // TODO: FIXME - windows currently throws 'nuxt-foo' is not recognized as an internal or external command, operable program or batch file.
  it.skipIf(isWindows)('throws error if wrong command is provided', async () => {
    const res = await x(nuxi, ['foo'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] Unknown command `foo`\n')
  })

  const testsToRun = Object.entries(tests).filter(([_, value]) => value !== 'todo')
  it.each(testsToRun)(`%s`, { timeout: isWindows ? 200000 : 50000 }, (_, test) => (test as () => Promise<void>)())

  for (const [command, value] of Object.entries(tests)) {
    if (value === 'todo') {
      it.todo(command)
    }
  }
})

async function fetchWithPolling(url: string, options: RequestInit = {}, maxAttempts = 10, interval = 100): Promise<Response> {
  let response: Response | null = null
  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      response = await fetch(url, options)
      if (response.ok) {
        return response
      }
    }
    catch {
      // Ignore errors and retry
    }
    attempts++
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return response as Response
}
