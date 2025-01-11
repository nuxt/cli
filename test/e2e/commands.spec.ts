import type { TestFunction } from 'vitest'
import type { commands } from '../../src/commands'

import { existsSync } from 'node:fs'

import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWindows } from 'std-env'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../playground', import.meta.url))

describe('commands', () => {
  const tests: Record<keyof typeof commands, 'todo' | TestFunction<object>> = {
    _dev: 'todo',
    add: async () => {
      const file = join(fixtureDir, 'server/api/test.ts')
      await rm(file, { force: true })
      await x('nuxi', ['add', 'api', 'test'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })
      expect(existsSync(file)).toBeTruthy()
      await rm(file, { force: true })
    },
    analyze: 'todo',
    build: 'todo',
    cleanup: 'todo',
    devtools: 'todo',
    module: 'todo',
    prepare: 'todo',
    preview: 'todo',
    start: 'todo',
    test: 'todo',
    typecheck: 'todo',
    upgrade: 'todo',
    dev: 'todo',
    generate: 'todo',
    init: async () => {
      const dir = tmpdir()
      for (const pm of ['pnpm']) {
        const installPath = join(dir, pm)
        await rm(installPath, { recursive: true, force: true })
        try {
          await x('nuxi', ['init', installPath, `--packageManager=${pm}`, '--gitInit=false', '--preferOffline', '--install=false'], {
            throwOnError: true,
            nodeOptions: { stdio: 'inherit', cwd: fixtureDir },
          })
          const files = await readdir(installPath).catch(() => [])
          expect(files).toContain('nuxt.config.ts')
        }
        finally {
          await rm(installPath, { recursive: true, force: true })
        }
      }
    },
    info: 'todo',
  }

  it('throws error if no command is provided', async () => {
    const res = await x('nuxi', [], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] No command specified.\n')
  })

  // TODO: FIXME - windows currently throws 'nuxt-foo' is not recognized as an internal or external command, operable program or batch file.
  it.skipIf(isWindows)('throws error if wrong command is provided', async () => {
    const res = await x('nuxi', ['foo'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('[error] Unknown command `foo`\n')
  })

  const testsToRun = Object.entries(tests).filter(([_, value]) => value !== 'todo')
  it.each(testsToRun)(`%s`, (_, test) => (test as () => Promise<void>)(), { timeout: isWindows ? 200000 : 50000 })

  for (const [command, value] of Object.entries(tests)) {
    if (value === 'todo') {
      it.todo(command)
    }
  }
})
