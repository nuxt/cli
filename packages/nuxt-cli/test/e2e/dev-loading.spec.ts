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
      // The page polls for itself and the progress stream pushes to it, so a
      // reload header would only throw away what it is showing.
      expect((response as Response).headers.get('refresh')).toBeNull()
      expect(html).toContain('Reloading Nuxt')
      expect(html).toContain('nuxt-loader-bar')
    }
    finally {
      await close()
    }
  })

  it('should answer requests that arrive before nuxt is ready', { timeout: 90_000 }, async () => {
    vi.stubEnv('NUXT_IGNORE_LOCK', '1')

    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3086 })
    const base = `http://${host}:${port}`

    const answered = (url: string, headers: Record<string, string>) => new Promise<Response>((resolve) => {
      const poll = async () => {
        const response = await fetch(url, { headers }).catch(() => undefined)
        if (!response) {
          setTimeout(poll, 5)
          return
        }
        resolve(response)
      }
      void poll()
    })

    const html = answered(base, { accept: 'text/html' })
    const json = answered(`${base}/api/unknown`, { accept: 'application/json' })

    const { close } = await initialize({ cwd: fixtureDir, args: {} }, {
      listenOverrides: { hostname: host, port },
      showBanner: false,
    })

    try {
      const loadingScreen = await html
      expect(loadingScreen.status).toBe(503)
      expect(loadingScreen.headers.get('content-type')).toContain('text/html')

      const loadingJSON = await json
      expect(loadingJSON.status).toBe(503)
      expect(await loadingJSON.json()).toMatchObject({ error: true, status: 503 })
    }
    finally {
      await close()
      vi.unstubAllEnvs()
    }
  })

  it('should answer the page\'s own readiness poll with the page, not json', { timeout: 90_000 }, async () => {
    vi.stubEnv('NUXT_IGNORE_LOCK', '1')

    const host = '127.0.0.1'
    const port = await getPort({ host, port: 3087 })
    const base = `http://${host}:${port}`

    // `fetch(location.href)` from the loading page sends `accept: *\/*`. Answered
    // with json, the page cannot find its own marker, decides the app is up and
    // reloads, which loops for as long as the build takes.
    const polled = new Promise<Response>((resolve) => {
      const poll = async () => {
        const response = await fetch(base, { headers: { accept: '*/*' } }).catch(() => undefined)
        if (!response || response.status !== 503) {
          setTimeout(poll, 5)
          return
        }
        resolve(response)
      }
      void poll()
    })

    const { close } = await initialize({ cwd: fixtureDir, args: {} }, {
      listenOverrides: { hostname: host, port },
      showBanner: false,
    })

    try {
      const response = await polled
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('__NUXT_LOADING__')
    }
    finally {
      await close()
      vi.unstubAllEnvs()
    }
  })
})
