import type { AddressInfo } from 'node:net'

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { runCommandDef } from '../../../nuxt-cli/src/run-command'
import { render, screen } from '../../../nuxt-cli/test/utils/terminal'
import initCommand from '../../src/init'

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
async function runFailing(argv: string[]) {
  let exitCode: number | undefined
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number | undefined
    throw new ExitError(exitCode)
  })

  const renderer = await render(async () => {
    await runCommandDef(initCommand, argv).catch((err) => {
      if (!(err instanceof ExitError)) {
        throw err
      }
    })
  })

  exit.mockRestore()
  return { output: screen(renderer), exitCode }
}

describe('network failures reported when scaffolding', () => {
  let dir: string
  let port: number

  beforeAll(async () => {
    port = await closedPort()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
    delete process.env.NUXI_INIT_REGISTRY
  })

  it('names the unreachable registry when a template cannot be downloaded', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-init-network-'))
    process.env.NUXI_INIT_REGISTRY = `http://127.0.0.1:${port}/templates`

    const { output, exitCode } = await runFailing([
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
})
