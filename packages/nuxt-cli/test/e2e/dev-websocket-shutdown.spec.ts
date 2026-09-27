import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { describe, expect, it } from 'vitest'
import { createDevFixture } from '../utils'

const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))
const fixtureDir = await createDevFixture('dev-websocket-shutdown')
await writeFile(join(fixtureDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({ nitro: { experimental: { websocket: true } } })\n')
await mkdir(join(fixtureDir, 'server/routes'), { recursive: true })
await writeFile(join(fixtureDir, 'server/routes/_ws.ts'), 'export default defineWebSocketHandler({ message(peer, message) { peer.send(message.text()) } })\n')

describe('dev server shutdown', () => {
  it('should exit promptly with an open websocket connection', { timeout: 120_000 }, async () => {
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3060 })
    // nitropack skips its graceful worker shutdown under test and CI
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['CI', 'TEST', 'VITEST', 'NODE_ENV', 'GITHUB_ACTIONS'].includes(key)))
    const child = spawn(process.execPath, [nuxi, 'dev', '--no-fork', '--host', host, '--port', String(port)], {
      cwd: fixtureDir,
      env: { ...env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = (data: string) => {
      output += data
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)

    try {
      await expect.poll(() => output, { timeout: 90_000, interval: 250 }).toContain('Ready in')

      const ws = new WebSocket(`ws://${host}:${port}/_ws`)
      const echo = await new Promise<string>((resolve, reject) => {
        ws.addEventListener('open', () => ws.send('ping'))
        ws.addEventListener('message', event => resolve(String(event.data)))
        ws.addEventListener('error', reject)
      })
      expect(echo).toBe('ping')

      const start = performance.now()
      child.kill('SIGINT')
      await once(child, 'exit')
      expect(performance.now() - start).toBeLessThan(5000)
    }
    finally {
      child.kill('SIGKILL')
    }
  })
})
