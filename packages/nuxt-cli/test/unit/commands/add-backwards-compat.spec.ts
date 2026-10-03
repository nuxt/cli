import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

import { createPlaygroundFixture } from '../../utils'

const fixtureDir = await createPlaygroundFixture('add-backwards-compat')
const nuxi = fileURLToPath(new URL('../../../bin/nuxi.mjs', import.meta.url))

describe('nuxt add backwards compatibility', () => {
  it.each([
    ['middleware', 'auth', 'app/middleware/auth.ts'],
    ['page', 'test-page', 'app/pages/test-page.vue'],
    ['composable', 'useTestComposable', 'app/composables/useTestComposable.ts'],
  ])('should create a %s file using deprecated syntax', async (template, name, file) => {
    const res = await x(nuxi, ['add', template, name], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })

    const output = res.stdout + res.stderr
    expect(output).toContain('Deprecated')
    expect(output).toContain('add-template')
    expect(existsSync(join(fixtureDir, file))).toBe(true)
  })
})
