import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { runCommand } from 'citty'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import curl from '../../../src/commands/curl'

interface ReceivedRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

const requests: ReceivedRequest[] = []

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  requests.push({
    method: req.method!,
    url: req.url!,
    headers: req.headers,
    body: Buffer.concat(chunks).toString('utf-8'),
  })

  if (req.url === '/missing') {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ statusCode: 404, message: 'Page not found' }))
    return
  }

  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ hello: 'world' }))
})

let origin: string
let cwd: string
let stdout: string

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(async () => {
  requests.length = 0
  stdout = ''
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-curl-test-'))
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

async function writeLock(url: string) {
  await mkdir(join(cwd, '.nuxt'), { recursive: true })
  await writeFile(join(cwd, '.nuxt', 'nuxt.lock'), JSON.stringify({
    pid: 424242,
    command: 'dev',
    cwd,
    url,
    startedAt: Date.now(),
  }))
  vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
}

/** Resolves with the exit code the command asked for, or `0` if it returned. */
async function run(args: string[]): Promise<number> {
  let code = 0
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0
    throw new Error(`exit:${code}`)
  }) as never)

  try {
    await runCommand(curl, { rawArgs: args })
  }
  catch (error) {
    if (!(error as Error).message.startsWith('exit:')) {
      throw error
    }
  }
  return code
}

describe('curl', () => {
  it('requests an absolute URL and prints the body', async () => {
    const code = await run([`${origin}/api/hello`])

    expect(code).toBe(0)
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/api/hello' })
    expect(stdout).toBe('{"hello":"world"}')
  })

  it('resolves a path against the running dev server', async () => {
    await writeLock(origin)
    const code = await run(['/api/hello', `--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(requests[0]?.url).toBe('/api/hello')
  })

  it('accepts a path without a leading slash', async () => {
    await writeLock(`${origin}/`)
    const code = await run(['api/hello', `--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(requests[0]?.url).toBe('/api/hello')
  })

  it('exits with 1 when no dev server is running', async () => {
    const code = await run(['/api/hello', `--cwd=${cwd}`])

    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('exits with 22 on a non-2xx response but still prints the body', async () => {
    const code = await run([`${origin}/missing`])

    expect(code).toBe(22)
    expect(stdout).toContain('Page not found')
  })

  it('sends headers, a body and defaults the method to POST', async () => {
    const code = await run([`${origin}/api/hello`, '-H', 'x-test: 1', '-d', '{"a":1}'])

    expect(code).toBe(0)
    expect(requests[0]).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
    })
    expect(requests[0]?.headers['x-test']).toBe('1')
    expect(requests[0]?.headers['content-type']).toBe('application/json')
    expect(requests[0]?.headers['user-agent']).toBe('nuxt-cli')
  })

  it('honours an explicit method', async () => {
    const code = await run([`${origin}/api/hello`, '-X', 'delete'])

    expect(code).toBe(0)
    expect(requests[0]?.method).toBe('DELETE')
  })

  it('rejects a malformed header', async () => {
    const code = await run([`${origin}/api/hello`, '-H', 'nope'])

    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })
})
