import type { Nuxt } from '@nuxt/schema'
import type { Listener } from 'listhen'

import { rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, bench, describe } from 'vitest'

import { runCommand } from '../../../nuxi/src/run'

interface RunResult {
  result: { listener: Listener, close: () => Promise<void> }
}

const fixtureDir = fileURLToPath(new URL('../../playground', import.meta.url))
async function clearDirectory() {
  await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
}

describe.each(['--fork', '--no-fork'])(`dev [${os.platform()}]`, async (fork) => {
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

describe(`dev requests [${os.platform()}]`, async () => {
  await clearDirectory()
  const { result } = await runCommand('dev', [fixtureDir]) as RunResult
  const url = result.listener.url

  bench('makes requests to dev server', async () => {
    const html = await fetch(url).then(r => r.text())
    if (!html.includes('Welcome to the Nuxt CLI playground!')) {
      throw new Error('Unexpected response from dev server')
    }
    await fetch(`${url}_nuxt/@vite/client`).then(r => r.text())
  }, { time: 10_000 })

  afterAll(result.close)
})
