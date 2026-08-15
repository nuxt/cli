import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { runCommand } from 'citty'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import info from '../../../src/commands/info'
import { render, screen } from '../../utils/terminal'

vi.mock('tinyclip', () => ({ writeText: () => Promise.reject(new Error('no clipboard')) }))

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-info-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

async function runInfo(): Promise<string> {
  const terminal = await render(() => runCommand(info, { rawArgs: [`--cwd=${cwd}`] }))
  return screen(terminal)
}

async function runInfoJSON(): Promise<any> {
  let stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    stdout += String(chunk)
    return true
  })
  await runCommand(info, { rawArgs: [`--cwd=${cwd}`, '--json'] })
  return JSON.parse(stdout)
}

describe('info command', () => {
  it('should report the config keys without their values', async () => {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'app', private: true }))
    await writeFile(join(cwd, 'nuxt.config.mjs'), `export default {
      runtimeConfig: { apiSecret: 'super-secret-token' },
      devServer: { host: '10.0.0.1' },
    }`)

    const output = await runInfo()

    expect(output).toContain('runtimeConfig')
    expect(output).not.toContain('super-secret-token')
    expect(output).not.toContain('10.0.0.1')
  })

  it('should not print environment variables', async () => {
    vi.stubEnv('NUXT_SECRET_TOKEN', 'env-secret-value')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'app', private: true }))

    const output = await runInfo()

    expect(output).not.toContain('env-secret-value')
    vi.unstubAllEnvs()
  })

  it('should list the modules a config declares', async () => {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'app', private: true }))
    await writeFile(join(cwd, 'nuxt.config.mjs'), `export default { modules: ['@nuxt/image'] }`)

    const output = await runInfo()

    expect(output).toContain('@nuxt/image')
  })

  it('should keep a comma in a config key or module path as one `--json` entry', async () => {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'app', private: true }))
    await writeFile(join(cwd, 'nuxt.config.mjs'), `export default {
      modules: ['./modules/a, b.ts'],
      'weird, key': true,
    }`)

    const payload = await runInfoJSON()

    expect(payload.config).toContain('weird, key')
    expect(payload.modules).toEqual(['./modules/a, b.ts'])
  })

  it('should still report on a project with no config', async () => {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'app', private: true }))

    const output = await runInfo()

    expect(output).toContain('Nuxt version')
  })
})
