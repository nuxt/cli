import type { Nuxt } from '@nuxt/schema'
import type { Listener } from 'listhen'

import { rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bench, describe } from 'vitest'

import { runCommand } from '../../../nuxi/src/run'

describe(`dev [${os.platform()}]`, async () => {
  const fixtureDir = fileURLToPath(new URL('../../playground', import.meta.url))
  await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })

  bench('starts dev server', async () => {
    const { result } = await runCommand('dev', [fixtureDir, '--fork'], {
      overrides: {
        builder: {
          bundle: (nuxt: Nuxt) => {
            nuxt.hooks.removeAllHooks()
            return Promise.resolve()
          },
        },
      },
    }) as { result: { listener: Listener } }
    await result.listener.close()
  })

  bench('starts dev server in no-fork mode', async () => {
    const { result } = await runCommand('dev', [fixtureDir, '--no-fork'], {
      overrides: {
        builder: {
          bundle: (nuxt: Nuxt) => {
            nuxt.hooks.removeAllHooks()
            return Promise.resolve()
          },
        },
      },
    }) as { result: { listener: Listener } }
    await result.listener.close()
  })

  const { result } = await runCommand('dev', [fixtureDir]) as { result: { listener: Listener } }
  const url = result.listener.url

  bench('makes requests to dev server', async () => {
    const html = await fetch(url).then(r => r.text())
    if (!html.includes('Welcome to the Nuxt CLI playground!')) {
      throw new Error('Unexpected response from dev server')
    }
    await fetch(`${url}_nuxt/@vite/client`).then(r => r.text())
  }, { time: 10_000 })
})
