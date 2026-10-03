import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { createRequest, currentRequest, runWithRequest } from '../../src/dev/serving-state'

describe('request attribution', () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  const queue: Array<() => void> = []

  it('has nothing to attribute a log to outside a request', () => {
    expect(currentRequest()).toBeUndefined()
  })

  it('attributes work on the call stack to the request that started it', () => {
    const request = createRequest('GET /about')
    runWithRequest(request, () => {
      expect(currentRequest()).toBeDefined()
      expect(currentRequest()?.label).toBe('GET /about')
      expect(currentRequest()?.id).toBe(request.id)
    })
    expect(currentRequest()).toBeUndefined()
  })

  it('keeps overlapping requests apart across await points', async () => {
    const seen: Array<[string, string | undefined]> = []
    const serve = async (label: string, delay: number) => {
      await new Promise(resolve => setTimeout(resolve, delay))
      seen.push([label, currentRequest()?.label])
      await tick()
      seen.push([label, currentRequest()?.label])
    }

    await Promise.all([
      runWithRequest(createRequest('GET /page'), () => serve('GET /page', 4)),
      runWithRequest(createRequest('GET /_nuxt/app.js'), () => serve('GET /_nuxt/app.js', 1)),
      runWithRequest(createRequest('GET /api/hello'), () => serve('GET /api/hello', 2)),
    ])

    expect(seen).toHaveLength(6)
    for (const [label, attributed] of seen) {
      expect(attributed).toBe(label)
    }
  })

  it('follows a request into a nested callback the handler creates', async () => {
    const attributed = await runWithRequest(createRequest('GET /nested'), () => new Promise<string | undefined>((resolve) => {
      process.nextTick(() => {
        setImmediate(() => {
          queueMicrotask(() => resolve(currentRequest()?.label))
        })
      })
    }))
    expect(attributed).toBe('GET /nested')
  })

  it('gives a request an identity that cannot be guessed from its route or its neighbours', () => {
    const ids = Array.from({ length: 50 }, () => createRequest('GET /boom-page').id)
    const value = (id: string) => BigInt(`0x${id.replaceAll('-', '')}`)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id.replaceAll('-', '')).toMatch(/^[0-9a-f]{32}$/)
      expect(id).not.toContain('boom-page')
      expect(id).not.toContain('GET')
    }
    const distances = ids.slice(1).map((id, index) => value(id) - value(ids[index]!))
    expect(new Set(distances.map(String)).size).toBe(distances.length)
  })

  it('does not attribute work that has left the request context', async () => {
    let escaped: string | undefined = 'unset'
    runWithRequest(createRequest('GET /leaky'), () => {
      // A queue the handler does not own loses the context, by design.
      queue.push(() => {
        escaped = currentRequest()?.label
      })
    })
    const queued = queue.splice(0)
    for (const run of queued) {
      run()
    }
    await tick()
    expect(escaped).toBeUndefined()
  })
})
