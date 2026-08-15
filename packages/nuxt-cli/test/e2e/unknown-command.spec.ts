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

describe('unknown commands', () => {
  it('should suggest the closest command without printing usage', { timeout: 60_000 }, async () => {
    const res = await run(['biuld'])
    const output = res.stdout + res.stderr

    expect(res.exitCode).toBe(1)
    expect(output).toContain('Unknown command biuld. Did you mean nuxt build?')
    expect(output).toContain('nuxt --help')
    expect(output).not.toContain('USAGE')
  })

  it('should not guess when nothing is close enough', { timeout: 60_000 }, async () => {
    const res = await run(['zzzzzz'])
    const output = res.stdout + res.stderr

    expect(res.exitCode).toBe(1)
    expect(output).toContain('Unknown command zzzzzz')
    expect(output).not.toContain('Did you mean')
  })
})
