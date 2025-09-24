import { fileURLToPath } from 'node:url'
import { $fetch, setup } from '@nuxt/test-utils'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
})

describe('built server', () => {
  it('should start and return HTML', async () => {
    const html = await $fetch('/')

    expect(html).toContain('Welcome to the Nuxt CLI playground')
  })
})
