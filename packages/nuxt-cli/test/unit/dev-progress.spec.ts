import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, expect, it, vi } from 'vitest'

import { withProgress } from '../../src/dev/loading-page'
import { DevProgress, PROGRESS_PATH } from '../../src/dev/progress'
import { NuxtDevServer } from '../../src/dev/utils'

function createResponse() {
  const chunks: string[] = []
  const listeners = new Map<string, () => void>()
  const res = {
    writableEnded: false,
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    end() {
      this.writableEnded = true
    },
    once(event: string, listener: () => void) {
      listeners.set(event, listener)
      return this
    },
  }
  return {
    res: res as unknown as ServerResponse,
    headers: res.headers,
    chunks,
    close: () => listeners.get('close')?.(),
  }
}

function events(chunks: string[]) {
  return chunks
    .join('')
    .split('\n\n')
    .filter(block => block.startsWith('event:'))
    .map((block) => {
      const [event, data] = block.split('\n')
      return { event: event!.slice('event: '.length), data: JSON.parse(data!.slice('data: '.length)) }
    })
}

function request(url: string, accept = 'text/html') {
  return { url, headers: { accept } } as unknown as IncomingMessage
}

describe('devProgress', () => {
  it('should only move forward through phases', () => {
    const progress = new DevProgress()
    progress.start()
    progress.setPhase('bundle')
    progress.setPhase('modules')

    expect(progress.snapshot.phase).toBe('bundle')
  })

  it('should record how long each phase took', () => {
    const progress = new DevProgress()
    progress.start()
    progress.setPhase('modules')
    progress.setReady()

    expect(progress.snapshot.status).toBe('ready')
    expect(progress.snapshot.progress).toBe(1)
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules'])
  })

  it('should derive phases from nuxt hooks', () => {
    const progress = new DevProgress()
    let callHook: (name: string) => void = () => {}
    progress.start()
    progress.attachNuxt({ beforeEach: fn => (callHook = name => fn({ name })) })

    callHook('modules:before')
    expect(progress.snapshot.phase).toBe('modules')

    callHook('nitro:build:before')
    expect(progress.snapshot.phase).toBe('server')
  })

  it('should stream snapshots to subscribers', () => {
    const progress = new DevProgress()
    progress.start()

    const { res, chunks } = createResponse()
    expect(progress.handleRequest(request(PROGRESS_PATH), res)).toBe(true)

    progress.setPhase('bundle')
    progress.setReady()

    expect(events(chunks).map(entry => [entry.event, entry.data.phase])).toEqual([
      ['nuxt:loading', 'config'],
      ['nuxt:loading', 'bundle'],
      ['nuxt:ready', 'ready'],
    ])
  })

  it('should not claim requests for other paths', () => {
    const progress = new DevProgress()
    const { res } = createResponse()

    expect(progress.handleRequest(request('/'), res)).toBe(false)
  })

  it('should push build errors and recovery to subscribers', () => {
    const progress = new DevProgress()
    progress.start()

    const { res, chunks } = createResponse()
    progress.handleRequest(request(`${PROGRESS_PATH}?t=1`), res)

    progress.setError(new Error('boom'))
    expect(progress.snapshot.status).toBe('error')

    progress.start('nuxt.config.ts changed. Reloading Nuxt...', true)
    progress.setReady()

    expect(events(chunks).map(entry => entry.event)).toEqual([
      'nuxt:loading',
      'nuxt:error',
      'nuxt:loading',
      'nuxt:ready',
    ])
    expect(events(chunks)[1]!.data.error).toEqual({ name: 'Error', message: 'boom' })
  })

  it('should replay the current state to a client that connects late', () => {
    const progress = new DevProgress()
    progress.start()
    progress.setPhase('bundle')

    const { res, chunks } = createResponse()
    progress.handleRequest(request(PROGRESS_PATH), res)

    expect(events(chunks)).toHaveLength(1)
    expect(events(chunks)[0]!.data.phase).toBe('bundle')
  })

  it('should stop tracking a client once it disconnects', () => {
    const progress = new DevProgress()
    progress.start()

    const { res, chunks, close } = createResponse()
    progress.handleRequest(request(PROGRESS_PATH), res)
    close()
    progress.setReady()

    expect(events(chunks)).toHaveLength(1)
  })

  it('should notify local listeners', () => {
    const progress = new DevProgress()
    const listener = vi.fn()
    const unsubscribe = progress.onUpdate(listener)

    progress.start()
    unsubscribe()
    progress.setReady()

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('dev server internal endpoints', () => {
  function createServer() {
    return new NuxtDevServer({ cwd: process.cwd(), dotenv: {}, overrides: {} })
  }

  it('should answer the progress stream before nuxt is ready', async () => {
    const server = createServer()
    const { res, chunks, headers } = createResponse()

    await Promise.race([
      server.handler(request(PROGRESS_PATH), res),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('request hung')), 500)),
    ])

    expect(chunks.join('')).toContain('retry: 1000')
    expect(headers['content-type']).toBe('text/event-stream')
  })
})

describe('loading page', () => {
  it('should inline everything it needs to subscribe to progress', () => {
    const progress = new DevProgress()
    progress.start()
    progress.setPhase('bundle')

    const html = withProgress('<html><body></body></html>', progress.snapshot)

    expect(html).toContain(`"progressPath":"${PROGRESS_PATH}"`)
    expect(html).toContain('nuxt:ready')
    expect(html).not.toContain('http-equiv="refresh"')
    expect(html).not.toMatch(/<(script|link)[^>]+src=|href=/)
  })
})
