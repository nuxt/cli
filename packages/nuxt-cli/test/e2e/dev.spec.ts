import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { describe, expect, it } from 'vitest'
import { runCommand } from '../../src'

const fixtureDir = fileURLToPath(new URL('../fixtures/dev', import.meta.url))

describe('dev server', () => {
  it('should expose dev server address to nuxt options', { timeout: 50_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3031 })
    await runCommand('dev', [`--host=${host}`, `--port=${port}`, `--cwd=${fixtureDir}`], {
      overrides: {
        modules: [
          fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
        ],
      },
    }).catch(() => null)
    const options = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
    expect(options).toMatchObject({
      https: false,
      host,
      port,
      url: `http://${host}:${port}/`,
    })
  })

  // TODO: fix this test
  it.fails('should respect configured devServer options', { timeout: 50_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3050 })
    await runCommand('dev', [`--cwd=${fixtureDir}`], {
      overrides: {
        devServer: {
          host,
          port,
        },
        modules: [
          fileURLToPath(new URL('../fixtures/log-dev-server-options.ts', import.meta.url)),
        ],
      },
    }).catch(() => null)
    const options = await readFile(join(fixtureDir, '.nuxt/dev-server.json'), 'utf-8').then(JSON.parse)
    expect(options).toMatchObject({
      https: false,
      host,
      port,
      url: `http://${host}:${port}/`,
    })
  })
})
