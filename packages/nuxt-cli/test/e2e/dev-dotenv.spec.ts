import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { expect, it, vi } from 'vitest'
import { createDevFixture } from '../utils'

const fixtureDir = await createDevFixture('dev-dotenv')
const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

it('should reload dotenv values across successive fork restarts while preserving shell variables', { timeout: 180_000 }, async () => {
  await writeFile(join(fixtureDir, 'nuxt.config.ts'), `export default defineNuxtConfig({
  runtimeConfig: { public: { marker: 'default', shell: 'default' } },
})
`)
  await writeFile(join(fixtureDir, 'server/api/dotenv.ts'), `export default defineEventHandler(() => ({
  pid: process.pid,
  ...useRuntimeConfig().public,
}))
`)
  const dotenv = join(fixtureDir, '.env')
  await writeFile(dotenv, 'NUXT_PUBLIC_MARKER=before\nNUXT_PUBLIC_SHELL=file\n')

  const host = '127.0.0.1'
  const port = await getPort({ host })
  const server = spawn(process.execPath, [nuxi, 'dev', fixtureDir, '--host', host, '--port', String(port), '--no-tui'], {
    env: { ...process.env, NODE_ENV: 'development', TEST: '', CI: '1', NUXT_PUBLIC_MARKER: undefined, NUXT_PUBLIC_SHELL: 'shell' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(server, 'exit')
  let output = ''
  server.stdout.on('data', (chunk) => {
    output += chunk
  })
  server.stderr.on('data', (chunk) => {
    output += chunk
  })

  async function waitForMarker(marker: string, previousPid?: number): Promise<number> {
    let pid = 0
    await vi.waitFor(async () => {
      expect(server.exitCode, output).toBeNull()
      const response = await fetch(`http://${host}:${port}/api/dotenv`, { signal: AbortSignal.timeout(5000) })
      expect(response.status).toBe(200)
      const value = await response.json() as { pid: number, marker: string, shell: string }
      expect(value).toMatchObject({ marker, shell: 'shell' })
      expect(value.pid).not.toBe(previousPid)
      pid = value.pid
    }, { timeout: 45_000, interval: 250 })
    return pid
  }

  try {
    let pid = await waitForMarker('before')
    for (const marker of ['after', 'third']) {
      await writeFile(dotenv, `NUXT_PUBLIC_MARKER=${marker}\nNUXT_PUBLIC_SHELL=file\n`)
      pid = await waitForMarker(marker, pid)
    }
    await writeFile(dotenv, '')
    await waitForMarker('default', pid)
  }
  catch (error) {
    console.error(output)
    throw error
  }
  finally {
    server.kill('SIGTERM')
    await exited
  }
})
