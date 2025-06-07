import type { Nuxt } from '@nuxt/schema'
import type { Listener } from 'listhen'

import { rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCommand } from '@nuxt/cli'
import { bench, describe } from 'vitest'

interface RunResult {
  result: { listener: Listener, close: () => Promise<void> }
}

const fixtureDir = fileURLToPath(new URL('../../playground', import.meta.url))
async function clearDirectory() {
  await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
}

describe.each(['--no-fork', '--fork'])(`dev [${os.platform()}]`, async (fork) => {
  await clearDirectory()

  bench(`starts dev server with ${fork}`, async () => {
    const { result } = await runCommand('dev', [fixtureDir, fork], {
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
})

describe(`dev [${os.platform()}] requests`, () => {
  let url: string
  let close: () => Promise<void>

  bench('makes requests to dev server', async () => {
    if (!url) {
      await clearDirectory()
      const { result } = await runCommand('dev', [fixtureDir, '--no-fork']) as RunResult
      url = result.listener.url
      close = result.close
    }
    const html = await fetch(url).then(r => r.text())
    if (!html.includes('Welcome to the Nuxt CLI playground!')) {
      throw new Error('Unexpected response from dev server')
    }
    await fetch(`${url}_nuxt/@vite/client`).then(r => r.text())
  }, {
    warmupIterations: 1,
    async teardown() {
      await close()
    },
    time: 10_000,
  })
})
