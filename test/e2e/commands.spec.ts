import type { TestFunction } from 'vitest'
import type { commands } from '../../src/commands'

import { fileURLToPath } from 'node:url'
import { isWindows } from 'std-env'

import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../playground', import.meta.url))

describe('commands', () => {
  const tests: Record<keyof typeof commands, 'todo' | TestFunction<object>> = {
    _dev: 'todo',
    add: 'todo',
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
    init: 'todo',
    info: 'todo',
  }

  it('throws error if no command is provided', async () => {
    const res = await x('pnpm', ['nuxi'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(isWindows ? null : 1)
    expect(res.stderr).toBe('[error] No command specified.\n')
  })

  it('throws error if wrong command is provided', async () => {
    const res = await x('pnpm', ['nuxi', 'foo'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })
    expect(res.exitCode).toBe(isWindows ? null : 1)
    expect(res.stderr).toBe('[error] Unknown command `foo`\n')
  })

  const testsToRun = Object.entries(tests).filter(([_, value]) => value !== 'todo')
  it.each(testsToRun)(`%s`, (_, test) => (test as () => Promise<void>)())

  for (const [command, value] of Object.entries(tests)) {
    if (value === 'todo') {
      it.todo(command)
    }
  }
})
