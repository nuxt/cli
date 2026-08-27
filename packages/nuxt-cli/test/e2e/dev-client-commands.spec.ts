import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { getPort } from 'get-port-please'
import { x } from 'tinyexec'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initialize } from '../../src/dev'
import { createDevFixture } from '../utils'

/**
 * The commands that talk to a running dev server find it through the lock file
 * the server writes, so they are exercised against a real one rather than a
 * fabricated lock.
 */

const fixtureDir = await createDevFixture('dev-client-commands')
const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

const ENDPOINT = `import { defineEventHandler } from 'h3'

export default defineEventHandler(() => ({ hello: 'world', nested: { list: [1, 2, 3] } }))
`

const FAILING_ENDPOINT = `import { createError, defineEventHandler } from 'h3'

export default defineEventHandler(() => {
  throw createError({ statusCode: 418, statusMessage: 'I am a teapot' })
})
`

const host = '127.0.0.1'
let port: number
let close: (() => Promise<void>) | undefined

function run(args: string[], cwd = fixtureDir) {
  return x(nuxi, args, { nodeOptions: { stdio: 'pipe', cwd, env: { ...process.env, NO_COLOR: '1' } } })
}

function output(result: { stdout: string, stderr: string }) {
  return stripVTControlCharacters(result.stdout + result.stderr)
}

describe('commands that talk to a running dev server', () => {
  beforeAll(async () => {
    await mkdir(join(fixtureDir, 'server/api'), { recursive: true })
    await writeFile(join(fixtureDir, 'server/api/greeting.ts'), ENDPOINT)
    await writeFile(join(fixtureDir, 'server/api/teapot.ts'), FAILING_ENDPOINT)

    port = await getPort({ host, port: 3092 })
    const server = await initialize({ cwd: fixtureDir, args: {} }, {
      listenOverrides: { hostname: host, port },
      showBanner: false,
    })
    close = server.close
  }, 120_000)

  afterAll(async () => {
    await close?.()
  })

  it('should resolve a path against the running server', async () => {
    const result = await run(['curl', '/api/greeting'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(output(result))).toEqual({ hello: 'world', nested: { list: [1, 2, 3] } })
  })

  it('should report the status and headers when asked to', async () => {
    const result = await run(['curl', '-i', '/api/greeting'])

    expect(output(result)).toContain('200')
    expect(output(result).toLowerCase()).toContain('content-type: application/json')
  })

  it('should pass a method, headers and a body through', async () => {
    const result = await run(['curl', '-X', 'POST', '-H', 'x-test: 1', '-d', '{"a":1}', '/api/greeting'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(output(result))).toMatchObject({ hello: 'world' })
  })

  it('should exit non-zero for an error response, as `curl --fail` does', async () => {
    const result = await run(['curl', '/api/teapot'])

    expect(result.exitCode).toBe(22)
    expect(output(result)).toContain('teapot')
  })

  it('should list the tasks the dev server exposes', async () => {
    const result = await run(['task', 'list'])

    expect(output(result)).not.toContain('No dev server')
    expect(result.exitCode).toBe(0)
  })

  it('should report the project`s versions', async () => {
    const result = await run(['info'])

    const text = output(result)
    expect(result.exitCode).toBe(0)
    expect(text).toContain('Nuxt')
    expect(text).toMatch(/Node.*\d\./)
  })
})

describe('commands with no dev server to talk to', () => {
  let cwd: string

  beforeAll(async () => {
    cwd = await createDevFixture('dev-client-commands-idle')
    await rm(join(cwd, '.nuxt'), { recursive: true, force: true })
  }, 120_000)

  it('should tell the user to start one rather than hanging', async () => {
    const result = await run(['curl', '/'], cwd)

    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/dev server/i)
  })

  it('should refuse a request with no url rather than waiting for one', async () => {
    const result = await run(['curl'], cwd)

    expect(result.exitCode).toBe(1)
    expect(output(result)).toMatch(/URL/)
  })
})
