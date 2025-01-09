import type { TestFunction } from 'vitest'
import type { commands } from '../../src/commands'

import { spawnSync } from 'node:child_process'

import { fileURLToPath } from 'node:url'
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
    const res = spawnSync('pnpm', ['nuxi'], {
      cwd: fixtureDir,
    })
    expect(res.status).toBe(1)
    expect(res.stderr.toString()).toBe('[error] No command specified.\n')
  })

  it('throws error if wrong command is provided', async () => {
    const res = spawnSync('pnpm', ['nuxi', 'foo'], {
      cwd: fixtureDir,
    })
    expect(res.status).toBe(1)
    expect(res.stderr.toString()).toBe('[error] Unknown command `foo`\n')
  })

  const testsToRun = Object.entries(tests).filter(([_, value]) => value !== 'todo')
  it.each(testsToRun)(`%s`, (_, test) => (test as () => Promise<void>)())

  for (const [command, value] of Object.entries(tests)) {
    if (value === 'todo') {
      it.todo(command)
    }
  }
})
