import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeNetworkError } from '../../../src/utils/network'
import { fetchTemplates, TEMPLATES_API_URL } from '../../../src/utils/starter-templates'

function respondAfter(delay: number) {
  return vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal

    // Only the template listing is slowed down; the per-template fetches that
    // follow it answer immediately so the test pays the delay once. Matched on
    // the host rather than a substring, which any URL could contain anywhere.
    const isListing = new URL(url instanceof Request ? url.url : String(url)).host === 'api.github.com'
    const body = isListing
      ? [{ name: 'minimal.json', type: 'file', download_url: 'https://raw.example.com/minimal.json' }]
      : { name: 'minimal', description: 'Minimal starter', defaultDir: 'nuxt-app', url: '', tar: '' }

    return new Promise<Response>((resolve, reject) => {
      if (!isListing) {
        resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
        return
      }

      const timer = setTimeout(() => resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })), delay)
      timer.unref()
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason)
      })
    })
  })
}

describe('fetchTemplates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tolerates a link slower than three seconds', async () => {
    vi.stubGlobal('fetch', respondAfter(3300))

    await expect(fetchTemplates()).resolves.toHaveProperty('minimal.name', 'minimal')
  }, 15_000)

  it('gives up rather than hanging on a dead link', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal) {
        signals.push(init.signal)
      }
      return respondAfter(60_000)(url, init)
    })

    const error = await fetchTemplates().catch((err: unknown) => err)

    expect(signals[0]?.aborted).toBe(true)
    expect(describeNetworkError(error, TEMPLATES_API_URL)).toContain('timed out')
  }, 15_000)
})
