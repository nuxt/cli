import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getPort } from 'get-port-please'
import { describe, expect, it, vi } from 'vitest'
import { initialize } from '../../src/dev'
import { createDevFixture } from '../utils'

const fixtureDir = await createDevFixture('dev-restart')

describe('dev server reload', () => {
  it('should settle in-flight requests when nuxt reloads', { timeout: 90_000 }, async () => {
    await rm(join(fixtureDir, '.nuxt'), { recursive: true, force: true })

    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3080 })
    const { close, reload } = await initialize({ cwd: fixtureDir, args: {} }, {
      listenOverrides: { hostname: host, port },
      showBanner: false,
    })
    const base = `http://${host}:${port}`

    try {
      const token = randomUUID()
      const inflight = fetch(`${base}/api/hang?token=${token}`).then(
        response => `status:${response.status}`,
        () => 'error',
      )

      await vi.waitFor(async () => {
        const { started } = await fetch(`${base}/api/hang-state?token=${token}`).then(r => r.json()) as { started: boolean }
        expect(started).toBe(true)
      }, { timeout: 30_000, interval: 100 })

      await reload({ type: 'shortcut' })

      const timer = new Promise<'hanging'>(resolve => setTimeout(resolve, 10_000, 'hanging').unref())
      await expect(Promise.race([inflight, timer])).resolves.toBe('status:503')
    }
    finally {
      await close()
    }
  })
})
