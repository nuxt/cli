import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bench, describe } from 'vitest'

import { runCommand } from '../../../nuxi/src/run'

describe('dev', async () => {
  const fixtureDir = fileURLToPath(new URL('../../playground', import.meta.url))
  await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })

  bench('starts dev server', async () => {
    const { result } = await runCommand('dev', [fixtureDir], {
      overrides: {
        builder: {
          bundle: (nuxt) => {
            nuxt.hooks.removeAllHooks()
            return Promise.resolve()
          },
        },
      },
    })
    await (result as { listener: any }).listener.close()
  })

  bench('starts dev server in no-fork mode', async () => {
    const { result } = await runCommand('dev', [fixtureDir, '--no-fork'], {
      overrides: {
        builder: {
          bundle: (nuxt) => {
            nuxt.hooks.removeAllHooks()
            return Promise.resolve()
          },
        },
      },
    })
    await (result as { listener: any }).listener.close()
  })

  // it.skip('makes requests to dev server', async () => {
  // })
})
