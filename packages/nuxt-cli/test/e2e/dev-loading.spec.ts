import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPort } from 'get-port-please'
import { describe, expect, it, vi } from 'vitest'
import { initialize } from '../../src/dev'
import { createDevFixture } from '../utils'

const fixtureDir = await createDevFixture('dev-loading')

describe('dev server loading screen', () => {
  it('should fall back to the loading page from the project\'s nuxt version', { timeout: 90_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })
    await writeFile(
      join(fixtureDir, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ devServer: { loadingTemplate: null } })\n',
    )

    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3085 })
    const { close, reload } = await initialize({ cwd: fixtureDir, args: {} }, {
      listenOverrides: { hostname: host, port },
      showBanner: false,
    })
    const base = `http://${host}:${port}`

    try {
      const token = randomUUID()
      const inflight = fetch(`${base}/api/hang?token=${token}`, { headers: { accept: 'text/html' } })

      await vi.waitFor(async () => {
        const { started } = await fetch(`${base}/api/hang-state?token=${token}`).then(r => r.json()) as { started: boolean }
        expect(started).toBe(true)
      }, { timeout: 30_000, interval: 100 })

      await reload({ type: 'shortcut' })

      const timer = new Promise<'hanging'>(resolve => setTimeout(resolve, 10_000, 'hanging').unref())
      const response = await Promise.race([inflight, timer])
      expect(response).not.toBe('hanging')

      const html = await (response as Response).text()
      expect((response as Response).status).toBe(503)
      expect((response as Response).headers.get('refresh')).toBe('3')
      expect(html).toContain('Reloading Nuxt')
      expect(html).toContain('nuxt-loader-bar')
    }
    finally {
      await close()
    }
  })
})
