import type { IncomingMessage } from 'node:http'

import { describe, expect, it, vi } from 'vitest'

import { isDocumentRequest } from '../../src/dev/utils'
import { WarmupGate } from '../../src/dev/warmup-gate'

/** Just enough of a response for the gate: it only ever waits for `close`. */
function response() {
  const listeners: Array<() => void> = []
  const res = {
    statusCode: 200,
    writableEnded: false,
    destroyed: false,
    once(_event: string, listener: () => void) {
      listeners.push(listener)
      return res
    },
    /** Finish the response as the app would, then close the socket. */
    end(status = 200) {
      res.statusCode = status
      res.writableEnded = true
      for (const listener of listeners.splice(0)) {
        listener()
      }
    },
    /** The client went away before anything was written. */
    abort() {
      res.destroyed = true
      for (const listener of listeners.splice(0)) {
        listener()
      }
    },
  }
  return res
}

function request(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { method: 'GET', url: '/', headers: { accept: 'text/html' }, ...overrides } as IncomingMessage
}

/**
 * Admit `count` requests at once, as separate tabs would, and report which of
 * them the gate has let through so far.
 */
function admitAll(gate: WarmupGate, count: number) {
  const responses = Array.from({ length: count }, response)
  const admitted = new Set<number>()
  const settled = responses.map((res, index) => gate.admit(res as never).then(() => void admitted.add(index)))
  return { responses, admitted, settled: Promise.all(settled) }
}

describe('which requests the warmup gate applies to', () => {
  it('should queue page renders', () => {
    expect(isDocumentRequest(request())).toBe(true)
    expect(isDocumentRequest(request({ headers: { accept: 'text/html,application/xhtml+xml' } }))).toBe(true)
  })

  it('should ignore everything that does not pay for the module graph', () => {
    expect(isDocumentRequest(request({ method: 'POST' }))).toBe(false)
    expect(isDocumentRequest(request({ headers: { accept: 'application/json' } }))).toBe(false)
    expect(isDocumentRequest(request({ headers: {} }))).toBe(false)
    expect(isDocumentRequest(request({ url: '/_nuxt/@vite/client' }))).toBe(false)
    expect(isDocumentRequest(request({ url: '/__nuxt_dev__/progress' }))).toBe(false)
    expect(isDocumentRequest(request({ headers: { 'accept': 'text/html', 'sec-fetch-dest': 'script' } }))).toBe(false)
  })
})

describe('the warmup gate', () => {
  it('should let two tabs render one at a time, then let the rest straight through', async () => {
    const gate = new WarmupGate()
    const { responses, admitted, settled } = admitAll(gate, 2)

    await Promise.resolve()
    expect([...admitted]).toEqual([0])

    responses[0]!.end()
    await settled
    expect([...admitted]).toEqual([0, 1])
    expect(gate.warmed).toBe(true)
  })

  it('should admit exactly one of twenty simultaneous requests until the first render lands', async () => {
    const gate = new WarmupGate()
    const { responses, admitted, settled } = admitAll(gate, 20)

    await vi.waitFor(() => expect(admitted.size).toBe(1))
    responses[0]!.end()
    await settled

    expect(admitted.size).toBe(20)
  })

  it('should be inert once a page has rendered', async () => {
    const gate = new WarmupGate()
    const leader = response()
    await gate.admit(leader as never)
    leader.end()

    const later = admitAll(gate, 5)
    await later.settled

    expect(later.admitted.size).toBe(5)
    // Nothing was waiting on anything, so nothing had to be closed to proceed.
    expect(later.responses.every(res => !res.writableEnded)).toBe(true)
  })

  it('should gate again after a reload, which compiles from cold once more', async () => {
    const gate = new WarmupGate()
    const first = response()
    await gate.admit(first as never)
    first.end()
    gate.rearm()

    const { responses, admitted } = admitAll(gate, 2)
    await Promise.resolve()

    expect([...admitted]).toEqual([0])
    responses[0]!.end()
  })

  it('should not let a failed render hold back or fail the request behind it', async () => {
    const gate = new WarmupGate()
    const { responses, admitted, settled } = admitAll(gate, 2)

    await Promise.resolve()
    responses[0]!.end(500)
    await vi.waitFor(() => expect(admitted.size).toBe(2))

    // The failure warmed nothing, so the next request renders under the gate too.
    expect(gate.warmed).toBe(false)
    responses[1]!.end()
    await settled
    expect(gate.warmed).toBe(true)
  })

  it('should hand the lead on when the leader disconnects mid-render', async () => {
    const gate = new WarmupGate()
    const { responses, admitted, settled } = admitAll(gate, 2)

    await Promise.resolve()
    responses[0]!.abort()
    await vi.waitFor(() => expect(admitted.size).toBe(2))

    expect(gate.warmed).toBe(false)
    responses[1]!.end()
    await settled
    expect(gate.warmed).toBe(true)
  })

  it('should not give the lead to a queued client that has gone away', async () => {
    const gate = new WarmupGate()
    const { responses, settled } = admitAll(gate, 3)

    await Promise.resolve()
    responses[1]!.abort()
    responses[0]!.end(500)
    await settled

    // The abandoned request took nothing with it: the live one still renders.
    expect(gate.warmed).toBe(false)
    responses[2]!.end()
    expect(gate.warmed).toBe(true)
  })

  it('should never hold a request longer than the wait it was given', async () => {
    vi.useFakeTimers()
    try {
      const gate = new WarmupGate({ timeout: 1000 })
      const { admitted } = admitAll(gate, 2)

      await vi.advanceTimersByTimeAsync(999)
      expect(admitted.size).toBe(1)

      await vi.advanceTimersByTimeAsync(2)
      expect(admitted.size).toBe(2)
      expect(gate.warmed).toBe(false)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('should release the queue when a leader never answers', async () => {
    vi.useFakeTimers()
    try {
      const gate = new WarmupGate({ timeout: 1000 })
      const leader = response()
      await gate.admit(leader as never)

      const follower = response()
      const admitted = gate.admit(follower as never)
      await vi.advanceTimersByTimeAsync(1001)
      await admitted

      expect(gate.warmed).toBe(false)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
