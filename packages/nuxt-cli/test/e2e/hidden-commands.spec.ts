import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))

const bins = {
  '@nuxt/cli': join(fileURLToPath(new URL('../..', import.meta.url)), 'bin/nuxi.mjs'),
  'nuxi': join(fileURLToPath(new URL('../../../nuxi', import.meta.url)), 'bin/nuxi.mjs'),
}

const hiddenCommands = ['_dev', 'start'] as const

function run(bin: string, args: string[]) {
  return x('node', [bin, ...args], {
    nodeOptions: { cwd: fixtureDir, env: { ...process.env, NO_COLOR: '1' } },
  }).then(res => res.stdout + res.stderr)
}

describe.each(Object.entries(bins))('hidden commands (%s)', (_name, bin) => {
  it.each(hiddenCommands)('should keep `%s` dispatchable', async (command) => {
    const output = await run(bin, [command, '--help'])
    expect(output).toContain(`${command} [OPTIONS] [ROOTDIR]`)
  })

  it('should not list hidden commands in help output', async () => {
    const output = await run(bin, ['--help'])
    for (const command of hiddenCommands) {
      expect(output).not.toContain(command)
    }
    expect(output).toContain('preview')
  })
})
