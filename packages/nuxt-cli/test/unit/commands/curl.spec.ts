import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'

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

const BINARY_BODY = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x1A, 0x0A, 0x00])

const ASSETS: Record<string, [contentType: string, body: string]> = {
  '/app.css': ['text/css', '.a { color: red }'],
  '/entry.js': ['text/javascript', 'export const a = 1'],
  '/plugin.ts': ['application/typescript', 'export const a: string = \'x\''],
  '/readme.md': ['text/markdown', '# Title'],
  '/sitemap.xml': ['application/xml', '<urlset><url><loc>/</loc></url></urlset>'],
  '/config.yaml': ['application/yaml', 'name: nuxt\nport: 3000'],
  '/log.ndjson': ['application/x-ndjson', '{"a":1}\n{"b":[true,null]}\n'],
  '/events.ndjson': ['application/ndjson', '{"a":1}\n{"b":[true,null]}\n'],
  '/fix.diff': ['text/x-diff', '- const a = 1\n+ const a = 2'],
  '/deploy.sh': ['application/x-sh', 'echo "hi"'],
  '/untyped': ['text/plain', '{"hello":"world"}'],
}

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

  const asset = ASSETS[req.url!]
  if (asset) {
    res.setHeader('content-type', asset[0])
    res.end(asset[1])
    return
  }

  if (req.url === '/binary') {
    res.setHeader('content-type', 'application/octet-stream')
    res.end(BINARY_BODY)
    return
  }

  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ hello: 'world' }))
})

let origin: string
let cwd: string
let stdout: string
let isTTY: boolean
const chunks: Buffer[] = []

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(async () => {
  requests.length = 0
  stdout = ''
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-curl-test-'))
  isTTY = process.stdout.isTTY
  process.stdout.isTTY = false
  chunks.length = 0
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    chunks.push(Buffer.from(chunk))
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  process.stdout.isTTY = isTTY
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

  it('rejects a body on a GET request', async () => {
    const code = await run([`${origin}/api/hello`, '-X', 'GET', '-d', '{}'])

    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('reads a request body from a file', async () => {
    const path = join(cwd, 'body.json')
    await writeFile(path, '{"from":"file"}')
    const code = await run([`${origin}/api/hello`, '-d', `@${path}`])

    expect(code).toBe(0)
    expect(requests[0]?.body).toBe('{"from":"file"}')
  })

  it('reports a missing request body file instead of throwing', async () => {
    const code = await run([`${origin}/api/hello`, '-d', `@${join(cwd, 'nope.json')}`])

    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('sends every value of a repeated -H flag', async () => {
    const code = await run([`${origin}/api/hello`, '-H', 'x-one: 1', '--header=x-two: 2'])

    expect(code).toBe(0)
    expect(requests[0]?.headers['x-one']).toBe('1')
    expect(requests[0]?.headers['x-two']).toBe('2')
  })

  it('sends a HEAD request and prints only the headers with -I', async () => {
    const code = await run([`${origin}/api/hello`, '-I'])

    expect(code).toBe(0)
    expect(requests[0]?.method).toBe('HEAD')
    expect(stdout).toContain('HTTP/1.1 200 OK')
    expect(stdout).toContain('content-type: application/json')
    expect(stdout).not.toContain('hello')
  })

  it('prints headers before the body with -i', async () => {
    const code = await run([`${origin}/api/hello`, '-i'])

    expect(code).toBe(0)
    expect(requests[0]?.method).toBe('GET')
    expect(stdout).toContain('HTTP/1.1 200 OK')
    expect(stdout.endsWith('{"hello":"world"}')).toBe(true)
  })

  it('writes binary responses byte for byte when piped', async () => {
    const code = await run([`${origin}/binary`])

    expect(code).toBe(0)
    expect(Buffer.concat(chunks).equals(BINARY_BODY)).toBe(true)
  })

  it.each([
    ['/app.css', 'color'],
    ['/entry.js', 'const'],
    ['/plugin.ts', 'string'],
    ['/readme.md', '# Title'],
    ['/sitemap.xml', 'urlset'],
    ['/config.yaml', 'name'],
    ['/log.ndjson', '{"a":1}'],
    ['/fix.diff', '+ const a = 2'],
    ['/deploy.sh', 'echo'],
  ])('highlights %s in a terminal', async (path, token) => {
    process.stdout.isTTY = true
    const code = await run([`${origin}${path}`])

    expect(code).toBe(0)
    expect(stdout).toContain('\u001B[')
    expect(stripVTControlCharacters(stdout)).toContain(token)
  })

  it('indents an xml response for a terminal, but leaves a pipe untouched', async () => {
    expect(await run([`${origin}/sitemap.xml`])).toBe(0)
    expect(stdout).toBe('<urlset><url><loc>/</loc></url></urlset>')

    stdout = ''
    process.stdout.isTTY = true
    expect(await run([`${origin}/sitemap.xml`])).toBe(0)
    expect(stripVTControlCharacters(stdout)).toBe('<urlset>\n  <url>\n    <loc>/</loc>\n  </url>\n</urlset>\n')
  })

  it('leaves the body untouched for a terminal when --no-pretty is set', async () => {
    process.stdout.isTTY = true
    expect(await run([`${origin}/sitemap.xml`, '--no-pretty'])).toBe(0)
    expect(stdout).toBe('<urlset><url><loc>/</loc></url></urlset>')
    expect(stdout).not.toContain('\u001B[')
  })

  it('formats a piped body when --pretty is forced', async () => {
    expect(await run([`${origin}/sitemap.xml`, '--pretty'])).toBe(0)
    expect(stripVTControlCharacters(stdout)).toBe('<urlset>\n  <url>\n    <loc>/</loc>\n  </url>\n</urlset>\n')
  })

  it('takes a text/plain body at its word, even when it looks like json', async () => {
    process.stdout.isTTY = true
    expect(await run([`${origin}/untyped`])).toBe(0)
    expect(stdout).toBe('{"hello":"world"}\n')
  })

  it.each(['/log.ndjson', '/events.ndjson'])('highlights newline-delimited json a record at a time (%s)', async (path) => {
    process.stdout.isTTY = true
    const code = await run([`${origin}${path}`])

    expect(code).toBe(0)
    expect(stdout).toContain('\u001B[')
    expect(stripVTControlCharacters(stdout)).toBe('{"a":1}\n{"b":[true,null]}\n')
  })

  it('does not write binary responses to a terminal', async () => {
    process.stdout.isTTY = true
    const code = await run([`${origin}/binary`])

    expect(code).toBe(0)
    expect(stdout).toContain('Binary data not shown in terminal')
    expect(stdout).not.toContain('PNG')
  })
})
