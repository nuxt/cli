import type { Nuxt } from '@nuxt/schema'
import type { Listener } from 'listhen'

import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { runCommand } from '@nuxt/cli'
import { bench, describe } from 'vitest'

interface RunResult {
  result: { listener: Listener, close: () => Promise<void> }
}

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))

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
})
