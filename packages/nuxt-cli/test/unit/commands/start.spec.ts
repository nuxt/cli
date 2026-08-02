import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import start from '../../../src/commands/start'
import { runCommandDef } from '../../../src/run-command'

const tempDirs: string[] = []

vi.mock('../../../src/utils/kit', () => ({
  loadKit: async () => ({
    loadNuxt: async () => ({ close: async () => {} }),
  }),
}))

vi.mock('@clack/prompts', async importOriginal => ({
  ...await importOriginal<typeof import('@clack/prompts')>(),
  box: vi.fn(),
  outro: vi.fn(),
}))

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture(command: string) {
  const cwd = await mkdtemp(join(process.cwd(), '.tmp-preview-'))
  tempDirs.push(cwd)

  const outputDir = join(cwd, '.output')
  await mkdir(outputDir)
  await writeFile(join(outputDir, 'nitro.json'), JSON.stringify({
    preset: 'test',
    commands: { preview: command },
  }))

  return { cwd, outputDir }
}

describe('start command execution', () => {
  it('supports quoted arguments in Nitro preview commands', async () => {
    const { cwd, outputDir } = await fixture('node server.mjs "hello world"')
    await writeFile(join(outputDir, 'server.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync('result', process.argv[2])`)

    await runCommandDef(start, [cwd])

    expect(await readFile(join(outputDir, 'result'), 'utf8')).toBe('hello world')
  })

  it('does not interpret shell operators', async () => {
    const { cwd, outputDir } = await fixture('node server.mjs && node injected.mjs')
    await writeFile(join(outputDir, 'server.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync('result', JSON.stringify(process.argv.slice(2)))`)
    await writeFile(join(outputDir, 'injected.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync('injected', '1')`)

    await runCommandDef(start, [cwd])

    expect(JSON.parse(await readFile(join(outputDir, 'result'), 'utf8'))).toEqual(['&&', 'node', 'injected.mjs'])
    await expect(readFile(join(outputDir, 'injected'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the child environment and applies the port override', async () => {
    const { cwd, outputDir } = await fixture('node server.mjs')
    await writeFile(join(outputDir, 'server.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync('result', JSON.stringify({ port: process.env.NUXT_PORT, custom: process.env.PREVIEW_TEST }))`)
    vi.stubEnv('PREVIEW_TEST', 'present')

    await runCommandDef(start, [cwd, '--port', '4321'])

    expect(JSON.parse(await readFile(join(outputDir, 'result'), 'utf8'))).toEqual({ port: '4321', custom: 'present' })
  })

  it.skipIf(process.platform === 'win32')('resolves local executables used by Nitro presets', async () => {
    const { cwd, outputDir } = await fixture('preview-private-bin "hello world"')
    const binDir = join(outputDir, 'node_modules', '.bin')
    const bin = join(binDir, 'preview-private-bin')
    await mkdir(binDir, { recursive: true })
    await writeFile(bin, `#!/bin/sh\nprintf %s "$1" > result\n`)
    await chmod(bin, 0o755)

    await runCommandDef(start, [cwd])

    expect(await readFile(join(outputDir, 'result'), 'utf8')).toBe('hello world')
  })
})
