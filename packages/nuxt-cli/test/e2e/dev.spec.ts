import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../src'

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))

const certsDir = fileURLToPath(new URL('../../../../playground/certs', import.meta.url))
const httpsCert = join(certsDir, 'cert.dummy')
const httpsKey = join(certsDir, 'key.dummy')
const httpsPfx = join(certsDir, 'pfx.dummy')

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
    const httpsCertValue = (await readFile(httpsCert, { encoding: 'ascii' })).split(/\r?\n/)
    const httpsKeyValue = (await readFile(httpsKey, { encoding: 'ascii' })).split(/\r?\n/)

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
      expect(https.cert.split(/\r?\n/)).toEqual(httpsCertValue)
      expect(https.key.split(/\r?\n/)).toEqual(httpsKeyValue)
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
      expect(https.cert.split(/\r?\n/)).toEqual(httpsCertValue)
      expect(https.key.split(/\r?\n/)).toEqual(httpsKeyValue)
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
      expect(https.cert.split(/\r?\n/)).toEqual(httpsCertValue)
      expect(https.key.split(/\r?\n/)).toEqual(httpsKeyValue)
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
    const httpsCertValue = (await readFile(httpsCert, { encoding: 'ascii' })).split(/\r?\n/)
    const httpsKeyValue = (await readFile(httpsKey, { encoding: 'ascii' })).split(/\r?\n/)

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
      expect(https.cert.split(/\r?\n/)).toEqual(httpsCertValue)
      expect(https.key.split(/\r?\n/)).toEqual(httpsKeyValue)
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
      expect(https.cert.split(/\r?\n/)).toEqual(httpsCertValue)
      expect(https.key.split(/\r?\n/)).toEqual(httpsKeyValue)
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
