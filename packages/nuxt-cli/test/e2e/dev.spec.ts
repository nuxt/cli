import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))

describe('dev server', () => {
  it('should expose dev server address to nuxt options', { timeout: 50_000 }, async () => {
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3031 })
    await x('nuxt', ['dev', `--host=${host}`, `--port=${port}`], {
      nodeOptions: { cwd: fixtureDir },
      throwOnError: true,
    })
    const options = await readFile(join(fixtureDir, '.nuxt', 'dev-server.json'), 'utf-8').then(JSON.parse)
    expect(options).toMatchObject({
      https: false,
      host,
      port,
      url: `http://${host}:${port}/`,
    })
  })
})
