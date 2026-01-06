import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../../../../playground', import.meta.url))
const nuxi = fileURLToPath(new URL('../../../bin/nuxi.mjs', import.meta.url))

describe('nuxt add backwards compatibility', () => {
  it('should create middleware file using deprecated syntax', async () => {
    const file = join(fixtureDir, 'app/middleware/auth.ts')
    await rm(file, { force: true })

    const res = await x(nuxi, ['add', 'middleware', 'auth'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })

    // Should show deprecation warning (check both stdout and stderr)
    const output = res.stdout + res.stderr
    expect(output).toContain('Deprecated')
    expect(output).toContain('add-template')

    // Should still create the file
    expect(existsSync(file)).toBe(true)

    await rm(file, { force: true })
  })

  it('should create page file using deprecated syntax', async () => {
    const file = join(fixtureDir, 'app/pages/test-page.vue')
    await rm(file, { force: true })

    const res = await x(nuxi, ['add', 'page', 'test-page'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })

    const output = res.stdout + res.stderr
    expect(output).toContain('Deprecated')
    expect(existsSync(file)).toBe(true)

    await rm(file, { force: true })
  })

  it('should create composable file using deprecated syntax', async () => {
    const file = join(fixtureDir, 'app/composables/useTestComposable.ts')
    await rm(file, { force: true })

    const res = await x(nuxi, ['add', 'composable', 'useTestComposable'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })

    const output = res.stdout + res.stderr
    expect(output).toContain('Deprecated')
    expect(existsSync(file)).toBe(true)

    await rm(file, { force: true })
  })
})
