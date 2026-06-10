import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { getPort } from 'get-port-please'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../src'

const NEWLINE_RE = /\r?\n/

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))

const certsDir = fileURLToPath(new URL('../../../../playground/certs', import.meta.url))
const httpsCert = join(certsDir, 'cert.dummy')
const httpsKey = join(certsDir, 'key.dummy')
const httpsPfx = join(certsDir, 'pfx.dummy')

async function createFakePortless(url: string) {
  const binDir = await mkdtemp(join(tmpdir(), 'portless-bin-'))
  const logFile = join(binDir, 'portless.log')
  const scriptFile = join(binDir, 'portless.mjs')
  const unixBinary = join(binDir, 'portless')
  const windowsBinary = join(binDir, 'portless.cmd')

  await writeFile(scriptFile, `import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
appendFileSync(process.env.PORTLESS_LOG, \`\${args.join(' ')}\\n\`)

if (args[0] === '--version') {
  process.stdout.write('0.1.0\\n')
}
else if (args[0] === 'get') {
  process.stdout.write(\`\${process.env.PORTLESS_URL_VALUE || ''}\\n\`)
}
`)

  await writeFile(unixBinary, `#!/bin/sh
exec node "$(dirname "$0")/portless.mjs" "$@"
`)
  await chmod(unixBinary, 0o755)

  await writeFile(windowsBinary, `@echo off
node "%~dp0\\portless.mjs" %*
`)

  return { binDir, logFile, url }
}

function requestWithHost(url: string, hostHeader: string) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(url, { headers: { host: hostHeader } }, (res) => {
      resolve(res.statusCode || 0)
      res.resume()
    })
    req.on('error', reject)
    req.end()
  })
}

async function waitFor<T>(run: () => Promise<T>, check: (value: T) => boolean, timeout = 15_000) {
  const start = Date.now()
  let lastError: unknown

  while (Date.now() - start < timeout) {
    try {
      const value = await run()
      if (check(value)) {
        return value
      }
    }
    catch (error) {
      lastError = error
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out after ${timeout}ms`)
}

async function readPortlessLogLines(logFile: string) {
  try {
    return await readFile(logFile, 'utf-8').then(content => content.trim().split(NEWLINE_RE).filter(Boolean))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function extractLoggedURLs(calls: unknown[][]) {
  return calls.flatMap(call => call.flatMap((value) => {
    if (typeof value !== 'string') {
      return []
    }

    return (value.match(/https?:\/\/[^\s)]+/g) || []).map(normalizeLoggedURL)
  }))
}

function normalizeLoggedURL(url: string) {
  return stripVTControlCharacters(url)
    .trim()
    .replace(/[),.]+$/g, '')
    .replace(/\/$/, '')
}

describe('dev server', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should expose dev server address to nuxt options', { timeout: 50_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3031 })
    const { result: { close } } = await runCommand('dev', [`--host=${host}`, `--port=${port}`, `--cwd=${fixtureDir}`], {
      overrides: {
        modules: [
          fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
        ],
      },
    }) as any
    await close()
    const options = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
    expect(options).toMatchObject({
      https: false,
      host,
      port,
      url: `http://${host}:${port}/`,
    })
  })

  it('should respect configured devServer options', { timeout: 50_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3050 })
    const { result: { close } } = await runCommand('dev', [`--cwd=${fixtureDir}`], {
      overrides: {
        devServer: {
          host,
          port,
        },
        modules: [
          fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
        ],
      },
    }) as any
    await close()
    const options = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
    expect(options).toMatchObject({
      https: false,
      host,
      port,
      url: `http://${host}:${port}/`,
    })
  })

  it('should expose the dev server through portless', { timeout: 50_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3051 })
    const portlessURL = 'https://preview.fixtures-dev.localhost'
    const { binDir, logFile } = await createFakePortless(portlessURL)
    let close: (() => Promise<void>) | undefined

    vi.stubEnv('PATH', `${binDir}${delimiter}${process.env.PATH || ''}`)
    vi.stubEnv('PORTLESS_LOG', logFile)
    vi.stubEnv('PORTLESS_URL_VALUE', portlessURL)

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const result = await runCommand('dev', [`--host=${host}`, `--port=${port}`, `--cwd=${fixtureDir}`, '--portless']) as any
      close = result.result.close

      expect(await waitFor(
        () => requestWithHost(`http://${host}:${port}`, 'preview.fixtures-dev.localhost'),
        status => status === 200,
      )).toBe(200)

      await close?.()
      close = undefined

      const logLines = await readPortlessLogLines(logFile)

      expect(logLines[0]).toBe('--version')
      expect(logLines[1]).toBe('proxy start')
      expect(logLines[2]).toBe('get fixtures-dev')
      expect(logLines[3]).toBe(`alias preview.fixtures-dev ${port} --force`)
      expect(logLines[4]).toBe('alias --remove preview.fixtures-dev')
      expect(extractLoggedURLs(consoleLog.mock.calls)).toContain(portlessURL)
      expect(process.env.PORTLESS_URL).toBeUndefined()
    }
    finally {
      await close?.()
      consoleLog.mockRestore()
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('should reject combining portless and tunnel', async () => {
    await expect(runCommand('dev', ['--cwd', fixtureDir, '--portless', '--tunnel'])).rejects.toThrow('`--portless` cannot be used with `--tunnel`.')
  })

  it('should handle multiple set-cookie headers correctly', { timeout: 50_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3032 })

    const { result: { close } } = await runCommand('dev', [`--host=${host}`, `--port=${port}`, `--cwd=${fixtureDir}`]) as any

    try {
      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Make request to endpoint that sets multiple cookies
      const response = await fetch(`http://${host}:${port}/api/test-cookies`)

      // Get all set-cookie headers
      const setCookies = response.headers.getSetCookie()

      // Should have 3 separate cookies
      expect(setCookies).toHaveLength(3)

      // Each cookie should be separate (not joined with comma)
      expect(setCookies[0]).toContain('XSRF-TOKEN')
      expect(setCookies[1]).toContain('app-session')
      expect(setCookies[2]).toContain('user-pref')

      // Cookies should NOT contain each other (would happen if joined with comma)
      expect(setCookies[0]).not.toContain('app-session')
      expect(setCookies[1]).not.toContain('user-pref')
      expect(setCookies[0]).not.toContain('user-pref')

      // Verify response body
      const data = await response.json()
      expect(data).toEqual({ ok: true, cookies: 3 })
    }
    finally {
      await close()
    }
  })

  describe('https options', async () => {
    const httpsCertValue = (await readFile(httpsCert, { encoding: 'ascii' })).split(NEWLINE_RE)
    const httpsKeyValue = (await readFile(httpsKey, { encoding: 'ascii' })).split(NEWLINE_RE)

    it('should be applied cert and key from commandline', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3601 })
      const { result: { close } } = await runCommand('dev', [
        `--https`,
        `--https.cert=${httpsCert}`,
        `--https.key=${httpsKey}`,
        `--host=${host}`,
        `--port=${port}`,
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const { https, ...options } = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        host,
        port,
        url: `https://${host}:${port}/`,
      })
      expect(https).toBeTruthy()
      expect(https.cert.split(NEWLINE_RE)).toEqual(httpsCertValue)
      expect(https.key.split(NEWLINE_RE)).toEqual(httpsKeyValue)
    })

    it('should be applied pfx and passphrase from commandline', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3602 })
      const { result: { close } } = await runCommand('dev', [
        `--https`,
        `--https.pfx=${httpsPfx}`,
        `--https.passphrase=pass`,
        `--host=${host}`,
        `--port=${port}`,
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const { https, ...options } = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        host,
        port,
        url: `https://${host}:${port}/`,
      })
      expect(https).toBeTruthy()
      expect(https.cert.split(NEWLINE_RE)).toEqual(httpsCertValue)
      expect(https.key.split(NEWLINE_RE)).toEqual(httpsKeyValue)
    })

    it('should be override from commandline', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3603 })
      const { result: { close } } = await runCommand('dev', [
        `--https.cert=${httpsCert}`,
        `--https.key=${httpsKey}`,
        `--host=${host}`,
        `--port=${port}`,
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          devServer: {
            https: {
              cert: 'invalid-cert.pem',
              key: 'invalid-key.pem',
              host: 'localhost',
              port: 3000,
            },
          },
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const { https, ...options } = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        host,
        port,
        url: `https://${host}:${port}/`,
      })
      expect(https).toBeTruthy()
      expect(https.cert.split(NEWLINE_RE)).toEqual(httpsCertValue)
      expect(https.key.split(NEWLINE_RE)).toEqual(httpsKeyValue)
    })

    it('should be disabled from commandline', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3604 })
      const { result: { close } } = await runCommand('dev', [
        `--https=false`,
        `--host=${host}`,
        `--port=${port}`,
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          devServer: {
            https: true,
            host: 'localhost',
            port: 3000,
          },
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const options = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        https: false,
        host,
        port,
        url: `http://${host}:${port}/`,
      })
    })
  })

  describe('applied environment variables', async () => {
    const httpsCertValue = (await readFile(httpsCert, { encoding: 'ascii' })).split(NEWLINE_RE)
    const httpsKeyValue = (await readFile(httpsKey, { encoding: 'ascii' })).split(NEWLINE_RE)

    it('should be applied from NUXT_ environment variables', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3701 })

      vi.stubEnv('NUXT_HOST', host)
      vi.stubEnv('NUXT_PORT', `${port}`)
      vi.stubEnv('NUXT_SSL_CERT', httpsCert)
      vi.stubEnv('NUXT_SSL_KEY', httpsKey)

      const { result: { close } } = await runCommand('dev', [
        `--https`,
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const { https, ...options } = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        host,
        port,
        url: `https://${host}:${port}/`,
      })
      expect(https).toBeTruthy()
      expect(https.cert.split(NEWLINE_RE)).toEqual(httpsCertValue)
      expect(https.key.split(NEWLINE_RE)).toEqual(httpsKeyValue)
    })

    it('should be applied from NITRO_ environment variables', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3702 })

      vi.stubEnv('NITRO_HOST', host)
      vi.stubEnv('NITRO_PORT', `${port}`)
      vi.stubEnv('NITRO_SSL_CERT', httpsCert)
      vi.stubEnv('NITRO_SSL_KEY', httpsKey)

      const { result: { close } } = await runCommand('dev', [
        `--https`,
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const { https, ...options } = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        host,
        port,
        url: `https://${host}:${port}/`,
      })
      expect(https).toBeTruthy()
      expect(https.cert.split(NEWLINE_RE)).toEqual(httpsCertValue)
      expect(https.key.split(NEWLINE_RE)).toEqual(httpsKeyValue)
    })

    it('should be applied from HOST and PORT environment variables', { timeout: 50_000 }, async () => {
      await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
      const host = '127.0.0.1'
      const port = await getPort({ host, port: 3703 })

      vi.stubEnv('HOST', host)
      vi.stubEnv('PORT', `${port}`)

      const { result: { close } } = await runCommand('dev', [
        `--cwd=${fixtureDir}`,
      ], {
        overrides: {
          modules: [
            fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
          ],
        },
      }) as any
      await close()
      const options = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
      expect(options).toMatchObject({
        host,
        port,
        url: `http://${host}:${port}/`,
      })
    })
  })
})
