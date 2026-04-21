import type { Nuxt } from '@nuxt/schema'
import type { Listener } from 'listhen'

import http from 'node:http'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { runCommand } from '@nuxt/cli'
import { x } from 'tinyexec'
import { bench, describe } from 'vitest'

interface RunResult {
  result: { listener: Listener, close: () => Promise<void> }
}

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxiBin = fileURLToPath(new URL('../../../../packages/nuxi/bin/nuxi.mjs', import.meta.url))

describe(`dev [${os.platform()}]`, () => {
  bench(`starts dev server with --no-fork`, async () => {
    const { result } = await runCommand('dev', [fixtureDir, '--no-fork'], {
      overrides: {
        builder: {
          bundle: (nuxt: Nuxt) => {
            nuxt.hooks.removeAllHooks()
            return Promise.resolve()
          },
        },
      },
    }) as RunResult
    await result.close()
  })

  let url: string
  bench('makes requests to dev server', async () => {
    if (!url) {
      const { result } = await runCommand('dev', [fixtureDir, '--no-fork']) as RunResult
      url = result.listener.url
    }
    const html = await fetch(url).then(r => r.text())
    if (!html.includes('Welcome to the Nuxt CLI playground!')) {
      throw new Error('Unexpected response from dev server')
    }
    await fetch(`${url}_nuxt/@vite/client`).then(r => r.text())
  }, {
    warmupIterations: 1,
    time: 10_000,
  })

  bench('starts dev server (child process, full startup)', async () => {
    const port = 40000 + Math.floor(Math.random() * 10000)
    const proc = x('node', [nuxiBin, 'dev', fixtureDir, '--no-fork', `--port=${port}`], {
      nodeOptions: {
        stdio: 'pipe',
        env: {
          ...process.env,
          CI: 'true',
          NO_COLOR: '1',
        },
      },
    })

    // Wait for the dev server to be ready by polling
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill()
        reject(new Error('Dev server did not start within 60s'))
      }, 60_000)

      const interval = setInterval(() => {
        const req = http.get(`http://127.0.0.1:${port}`, (res) => {
          res.resume()
          if (res.statusCode === 200) {
            clearInterval(interval)
            clearTimeout(timeout)
            resolve()
          }
        })
        req.on('error', () => {})
        req.end()
      }, 200)
    })

    proc.kill()
  }, {
    warmupIterations: 0,
    iterations: 3,
    time: 0,
  })
})
