import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeNetworkError } from '../../../src/utils/network'
import { fetchOptionsFor, fetchTemplates, TEMPLATES_API_URL } from '../../../src/utils/starter-templates'

function respondAfter(delay: number) {
  return vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal

    // Only the template listing is slowed down; the per-template fetches that
    // follow it answer immediately so the test pays the delay once. Matched on
    // the host rather than a substring, which any URL could contain anywhere.
    const isListing = new URL(url instanceof Request ? url.url : String(url)).host === 'api.github.com'
    const body = isListing
      ? [{ name: 'minimal.json', type: 'file', download_url: 'https://raw.githubusercontent.com/nuxt/starter/templates/templates/minimal.json' }]
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

describe('github token handling', () => {
  const token = process.env.GITHUB_TOKEN

  afterEach(() => {
    vi.unstubAllGlobals()
    if (token === undefined) {
      delete process.env.GITHUB_TOKEN
    }
    else {
      process.env.GITHUB_TOKEN = token
    }
  })

  it('should send the token to github and to nowhere else', () => {
    process.env.GITHUB_TOKEN = 'secret-token'

    expect(fetchOptionsFor(TEMPLATES_API_URL).headers).toHaveProperty('authorization', 'token secret-token')
    expect(fetchOptionsFor('https://evil.example.com/minimal.json').headers).not.toHaveProperty('authorization')
    expect(fetchOptionsFor('http://api.github.com/x').headers).not.toHaveProperty('authorization')
    expect(fetchOptionsFor('https://api.github.com.evil.example.com/x').headers).not.toHaveProperty('authorization')
  })

  it('should skip a template whose download url is not on github', async () => {
    process.env.GITHUB_TOKEN = 'secret-token'
    const requested: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url)
      requested.push(href)
      const body = href === TEMPLATES_API_URL
        ? [{ name: 'evil.json', type: 'file', download_url: 'https://evil.example.com/evil.json' }]
        : { name: 'evil', description: '', defaultDir: 'nuxt-app', url: '', tar: '' }
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
    }))

    await expect(fetchTemplates()).resolves.toEqual({})
    expect(requested).toEqual([TEMPLATES_API_URL])
  })

  it('should not let a template name reach the prototype', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url)
      const body = href === TEMPLATES_API_URL
        ? [{ name: '__proto__.json', type: 'file', download_url: 'https://raw.githubusercontent.com/nuxt/starter/templates/templates/__proto__.json' }]
        : { polluted: true }
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
    }))

    const templates = await fetchTemplates()

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(templates)).toBeNull()
    expect(Object.hasOwn(templates, '__proto__')).toBe(true)
  })
})
