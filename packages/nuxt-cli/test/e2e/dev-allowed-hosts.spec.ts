import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { describe, expect, it } from 'vitest'
import { runCommand } from '../../src'
import { createDevFixture } from '../utils'

const fixtureDir = await createDevFixture('allowed-hosts')
const configFixtureDir = await createDevFixture('allowed-hosts-config')
const modulePath = fileURLToPath(new URL('../fixtures/log-vite-hosts.ts', import.meta.url))

async function resolveAllowedHosts(args: string[]): Promise<string[] | true | undefined> {
  const port = await getPort({ port: 3620 })
  const { result: { close } } = await runCommand('dev', [`--port=${port}`, `--cwd=${fixtureDir}`, ...args], {
    overrides: { modules: [modulePath] },
  }) as any
  await close()
  const { allowedHosts } = await readFile(join(fixtureDir, '.nuxt/vite-hosts.json'), 'utf-8').then(JSON.parse)
  return allowedHosts
}

async function startWithAllowedHosts(allowedHosts: string[] | true): Promise<{ port: number, close: () => Promise<void> }> {
  await writeFile(join(configFixtureDir, 'nuxt.config.ts'), `export default ${JSON.stringify({ vite: { server: { allowedHosts } } })}\n`)
  const port = await getPort({ host: '127.0.0.1', port: 3640 })
  const { result: { close } } = await runCommand('dev', ['--host=127.0.0.1', `--port=${port}`, `--cwd=${configFixtureDir}`]) as any
  return { port, close }
}

/** Status of the progress endpoint for a `Host` header, which `fetch` does not let a caller set. */
function progressStatusForHost(port: number, host: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/__nuxt_dev__/progress', headers: { host } }, (res) => {
      // The progress endpoint is a stream that does not end.
      res.destroy()
      resolve(res.statusCode)
    })
    req.once('error', reject)
    req.end()
  })
}

describe('dev server allowed hosts', () => {
  it('should derive the bound hostname once on the first load', { timeout: 120_000 }, async () => {
    const allowedHosts = await resolveAllowedHosts(['--host=127.0.0.1'])

    expect(allowedHosts).toEqual(['127.0.0.1'])
  })

  it('should keep the host allowlist for a non-loopback `--host`', { timeout: 120_000 }, async () => {
    const allowedHosts = await resolveAllowedHosts(['--host=0.0.0.0'])

    expect(allowedHosts).not.toBe(true)
    expect(allowedHosts).toContain('localhost')
  })

  it('should allow any host when the server is public', { timeout: 120_000 }, async () => {
    const allowedHosts = await resolveAllowedHosts(['--public'])

    expect(allowedHosts).toBe(true)
  })

  it('should allow the hosts in `vite.server.allowedHosts` on its own endpoints', { timeout: 120_000 }, async () => {
    const { port, close } = await startWithAllowedHosts(['.example.test'])

    try {
      expect(await progressStatusForHost(port, `app.example.test:${port}`)).toBe(200)
      expect(await progressStatusForHost(port, `example.test:${port}`)).toBe(200)
      expect(await progressStatusForHost(port, `rebinding-attacker.com:${port}`)).toBe(403)
    }
    finally {
      await close()
    }
  })

  it('should allow any host on its own endpoints for `vite.server.allowedHosts: true`', { timeout: 120_000 }, async () => {
    const { port, close } = await startWithAllowedHosts(true)

    try {
      expect(await progressStatusForHost(port, `rebinding-attacker.com:${port}`)).toBe(200)
    }
    finally {
      await close()
    }
  })
})
