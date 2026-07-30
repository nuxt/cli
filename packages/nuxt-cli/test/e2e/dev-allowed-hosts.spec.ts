import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { describe, expect, it } from 'vitest'
import { runCommand } from '../../src'
import { createDevFixture } from '../utils'

const fixtureDir = await createDevFixture('allowed-hosts')
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

describe('dev server allowed hosts', () => {
  it('should derive the bound hostname once on the first load', { timeout: 120_000 }, async () => {
    const allowedHosts = await resolveAllowedHosts(['--host=127.0.0.1'])

    expect(allowedHosts).toEqual(['127.0.0.1'])
  })

  it('should allow any host when the server is public', { timeout: 120_000 }, async () => {
    const allowedHosts = await resolveAllowedHosts(['--public'])

    expect(allowedHosts).toBe(true)
  })
})
