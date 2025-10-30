import { readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { runCommand } from '../../src'

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))

describe('dev server', () => {
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
})
