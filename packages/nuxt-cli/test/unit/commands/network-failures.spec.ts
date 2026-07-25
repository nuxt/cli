import type { CommandDef } from 'citty'
import type { AddressInfo } from 'node:net'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import initCommand from '../../../src/commands/init'
import moduleCommand from '../../../src/commands/module'
import * as moduleUtils from '../../../src/commands/module/_utils'
import addCommand from '../../../src/commands/module/add'
import { resolveTool } from '../../../src/dev/binaries'
import { runCommandDef } from '../../../src/run'
import { render, screen } from '../../utils/terminal'

/** A port nothing listens on, so connections to it are refused immediately. */
async function closedPort(): Promise<number> {
  const server = createServer()
  const port = await new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

/** Run a command that is expected to bail out, returning the screen and exit code. */
async function runFailing(command: CommandDef<any>, argv: string[]) {
  let exitCode: number | undefined
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number | undefined
    throw new ExitError(exitCode)
  })

  const renderer = await render(async () => {
    await runCommandDef(command, argv).catch((err) => {
      if (!(err instanceof ExitError)) {
        throw err
      }
    })
  })

  exit.mockRestore()
  return { output: screen(renderer), exitCode }
}

describe('network failures reported by commands', () => {
  let dir: string
  let port: number

  beforeAll(async () => {
    port = await closedPort()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
    delete process.env.NUXI_INIT_REGISTRY
    delete process.env.COREPACK_NPM_REGISTRY
  })

  it('names the unreachable registry when a template cannot be downloaded', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-init-network-'))
    process.env.NUXI_INIT_REGISTRY = `http://127.0.0.1:${port}/templates`

    const { output, exitCode } = await runFailing(initCommand, [
      `--cwd=${dir}`,
      'app',
      '--template=minimal',
      '--packageManager=npm',
      '--gitInit=false',
      '--install=false',
      '--no-modules',
    ])

    expect(output).toContain('Template download failed')
    expect(output).toContain(`Connection to 127.0.0.1:${port} was refused.`)
    expect(output).toContain('--offline')
    expect(output).toContain('NUXI_INIT_REGISTRY')
    expect(exitCode).toBe(1)
  })

  it('names the unreachable npm registry when module metadata cannot be fetched', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-add-network-'))
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app', devDependencies: { nuxt: '4.0.0' } }))
    process.env.COREPACK_NPM_REGISTRY = `http://127.0.0.1:${port}`

    // Only the modules database is stubbed; the registry request is real.
    vi.spyOn(moduleUtils, 'fetchModules').mockResolvedValue([])

    const { output } = await runFailing(addCommand, [`--cwd=${dir}`, '@nuxt/image', '--install=false'])

    expect(output).toContain('Failed to fetch package details for @nuxt/image.')
    expect(output).toContain(`Connection to 127.0.0.1:${port} was refused.`)
  })

  it('reports why the module database is unreachable when searching', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-search-network-'))

    // A genuine undici error rather than a hand-built one.
    const refused = await fetch(`http://127.0.0.1:${port}/`).catch((err: unknown) => err)
    vi.spyOn(moduleUtils, 'fetchModules').mockRejectedValue(refused)

    const { output, exitCode } = await runFailing(moduleCommand, ['search', `--cwd=${dir}`, 'image'])

    expect(output).toContain('Connection to api.nuxt.com was refused.')
    expect(exitCode).toBe(1)
  })
})

describe('dev tool downloads', () => {
  let home: string
  let port: number

  beforeAll(async () => {
    port = await closedPort()
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('says which host a tool could not be downloaded from', async () => {
    home = await mkdtemp(join(tmpdir(), 'nuxt-tool-network-'))
    // Isolate the cache and pre-accept the terms so the real download runs.
    // `rc9` reads `XDG_CONFIG_HOME` before `homedir()`, and `homedir()` itself
    // follows `USERPROFILE` on Windows, so all three have to be pinned.
    vi.stubEnv('XDG_CONFIG_HOME', home)
    vi.stubEnv('XDG_CACHE_HOME', join(home, 'cache'))
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    await writeFile(join(home, '.nuxtrc'), 'tools.probe.termsAccepted=true\n')

    let resolved: string | undefined
    const renderer = await render(async () => {
      resolved = await resolveTool('nuxt-probe-does-not-exist', {
        url: `http://127.0.0.1:${port}/probe.tgz`,
        consent: {
          key: 'probe',
          notice: [],
          message: 'ok?',
          nonInteractiveWarning: 'skipped',
        },
      })
    })

    expect(resolved).toBeUndefined()
    expect(screen(renderer)).toContain(`Connection to 127.0.0.1:${port} was refused.`)
  })
})
