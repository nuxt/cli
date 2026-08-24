import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))
const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

function run(args: string[]) {
  return x('node', [nuxi, ...args], {
    nodeOptions: { cwd: fixtureDir, env: { ...process.env, NO_COLOR: '1' } },
  })
}

describe('unknown flags', () => {
  it('should suggest the declared flag a misspelling is closest to', { timeout: 60_000 }, async () => {
    const res = await run(['prepare', '--loglevel=info'])
    const output = res.stdout + res.stderr

    expect(output).toContain('Unknown option --loglevel. Did you mean --logLevel?')
  })

  it('should pass through a flag nothing is close to', { timeout: 60_000 }, async () => {
    const res = await run(['prepare', '--ui-only'])
    const output = res.stdout + res.stderr

    expect(output).not.toContain('Unknown option')
  })
})
