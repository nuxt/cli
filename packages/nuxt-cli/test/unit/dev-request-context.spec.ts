import type { DevRequestSpan } from '../../src/dev/span-channel'

import { channel, tracingChannel } from 'node:diagnostics_channel'
import { BroadcastChannel } from 'node:worker_threads'

import { describe, expect, it, vi } from 'vitest'

import { DEV_LOG_CHANNEL, openDevLogChannel } from '../../src/dev/log-channel'
import { openDevSpanChannel } from '../../src/dev/span-channel'

const reporters: Array<{ log: (logObj: unknown) => void }> = []
vi.mock('consola', () => ({
  consola: { addReporter: (reporter: { log: (logObj: unknown) => void }) => reporters.push(reporter) },
}))

const { default: plugin } = await import('../../runtime/dev-request-context.mjs') as {
  default: (nitroApp: unknown) => void
}

const HEADER = 'x-nuxt-dev-request-id'
const LABEL_HEADER = 'x-nuxt-dev-request-label'

function nitroApp(handler: (event: unknown) => unknown) {
  const app = { handler: Object.assign(handler, { __is_handler__: true }) }
  return { app, nitroApp: { h3App: app } }
}

function eventFor(headers: Record<string, string> = {}) {
  return { node: { req: { headers, url: '/api/hello' } } }
}

function requestFor(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/hello', { headers })
}

describe('dev request context plugin', () => {
  it('leaves an app it cannot understand exactly as it found it', () => {
    for (const broken of [undefined, null, {}, { h3App: {} }, { h3App: { handler: 'not a function' } }]) {
      expect(() => plugin(broken)).not.toThrow()
    }
  })

  it('keeps the markers h3 puts on its handler', () => {
    const { app, nitroApp: instance } = nitroApp(() => 'served')
    plugin(instance)
    expect((app.handler as unknown as { __is_handler__: boolean }).__is_handler__).toBe(true)
  })

  it('serves the request whether or not it can be attributed', () => {
    const { app, nitroApp: instance } = nitroApp(() => 'served')
    plugin(instance)
    expect(app.handler(eventFor())).toBe('served')
    expect(app.handler(eventFor({ [HEADER]: 'req-7', [LABEL_HEADER]: 'GET%20%2Fapi%2Fhello' }))).toBe('served')
    expect(app.handler(eventFor({ [HEADER]: 'nonsense' }))).toBe('served')
  })

  it('leaves the request id on the request and takes its own label off', () => {
    const { app, nitroApp: instance } = nitroApp(() => 'served')
    plugin(instance)
    const event = eventFor({ [HEADER]: 'req-7', [LABEL_HEADER]: 'GET%20%2Fapi%2Fhello' })
    app.handler(event)
    expect(event.node.req.headers[HEADER]).toBe('req-7')
    expect(event.node.req.headers[LABEL_HEADER]).toBeUndefined()
  })

  it('attributes a request the app serves through `fetch`, id header intact', async () => {
    reporters.length = 0
    let seen: Array<string | null> = []
    const instance = {
      fetch: (req: Request) => {
        seen = [req.headers.get(HEADER), req.headers.get(LABEL_HEADER)]
        reporters[0]!.log({ level: 3, type: 'info', args: ['from the app'] })
        return 'served'
      },
    }
    plugin(instance)

    const received: unknown[] = []
    const close = openDevLogChannel(log => received.push(log))
    try {
      expect(instance.fetch(requestFor({ [HEADER]: 'req-42', [LABEL_HEADER]: 'GET%20%2Fapi%2Fhello' }))).toBe('served')
      expect(seen).toEqual(['req-42', null])
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({ origin: 'runtime', request: 'GET /api/hello', requestId: 'req-42' })
    }
    finally {
      close()
    }
  })

  it('still serves when reporting throws', async () => {
    reporters.length = 0
    const { app, nitroApp: instance } = nitroApp(() => 'served')
    plugin(instance)

    const channel = new BroadcastChannel(DEV_LOG_CHANNEL)
    channel.unref()
    channel.onmessage = () => {
      throw new Error('receiver exploded')
    }
    try {
      expect(reporters).toHaveLength(1)
      expect(() => reporters[0]!.log({ level: 3, type: 'info', args: [Object.create(null)] })).not.toThrow()
      expect(app.handler(eventFor({ [HEADER]: 'req-7', [LABEL_HEADER]: 'GET%20%2Fapi%2Fhello' }))).toBe('served')
    }
    finally {
      channel.close()
    }
  })

  it('reports the request a log was emitted for', async () => {
    reporters.length = 0
    const { app, nitroApp: instance } = nitroApp(() => {
      reporters[0]!.log({ level: 3, type: 'info', args: ['from the app'] })
      return 'served'
    })
    plugin(instance)

    const received: unknown[] = []
    const close = openDevLogChannel(log => received.push(log))
    try {
      app.handler(eventFor({ [HEADER]: 'req-42', [LABEL_HEADER]: 'GET%20%2Fapi%2Fhello' }))
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({
        message: 'from the app',
        origin: 'runtime',
        request: 'GET /api/hello',
        requestId: 'req-42',
      })
    }
    finally {
      close()
    }
  })

  it('reports a log with no request as build output', async () => {
    reporters.length = 0
    const { nitroApp: instance } = nitroApp(() => 'served')
    plugin(instance)

    const received: Array<{ origin: string, requestId?: string }> = []
    const close = openDevLogChannel(log => received.push(log))
    try {
      reporters[0]!.log({ level: 3, type: 'info', args: ['building'] })
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]!.origin).toBe('build')
      expect(received[0]!.requestId).toBeUndefined()
    }
    finally {
      close()
    }
  })

  it('reports spans published while serving a request, against that request', async () => {
    const before: Array<(event: { name: string, context: Record<symbol, unknown> }) => void> = []
    const after: typeof before = []
    const hooks = {
      _hooks: { 'render:html': [() => {}] } as Record<string, unknown[]>,
      beforeEach: (fn: (typeof before)[number]) => before.push(fn),
      afterEach: (fn: (typeof before)[number]) => after.push(fn),
      callHook(name: string) {
        const event = { name, context: {} }
        before.forEach(fn => fn(event))
        after.forEach(fn => fn(event))
      },
    }
    const fetchRequest = { method: 'GET', origin: 'https://api.example.com', path: '/data' }
    const { app, nitroApp: instance } = nitroApp(async () => {
      await tracingChannel('nuxt.plugin').tracePromise(async () => {}, { plugin: { name: 'nuxt:head' } })
      await tracingChannel('nuxt.hook').tracePromise(async () => {}, { name: 'app:rendered', args: [] })
      await tracingChannel('nuxt.hook').tracePromise(async () => {}, { hook: { name: 'app:created' } })
      await tracingChannel('nuxt.middleware').tracePromise(async () => {}, { middleware: { name: 'auth', global: false } })
      await tracingChannel('nuxt.middleware').tracePromise(async () => {}, { middleware: { path: '@/project/node_modules/nuxt/dist/app/middleware/guard.js', global: true } })
      await tracingChannel('nuxt.data').tracePromise(async () => {}, { key: 'posts', functionName: 'useFetch' })
      await tracingChannel('h3.request').tracePromise(async () => {}, { type: 'route', event: { req: { method: 'GET', url: 'http://localhost/api/posts?page=2' }, res: { status: 201 } } })
      hooks.callHook('render:html')
      hooks.callHook('request')
      channel('undici:request:create').publish({ request: fetchRequest })
      channel('undici:request:headers').publish({ request: fetchRequest, response: { statusCode: 200 } })
      channel('undici:request:trailers').publish({ request: fetchRequest })
      return 'served'
    })
    plugin({ ...instance, hooks })

    const received: DevRequestSpan[] = []
    const close = openDevSpanChannel(span => received.push(span))
    try {
      await tracingChannel('nuxt.plugin').tracePromise(async () => {}, { plugin: { name: 'outside a request' } })
      await app.handler(eventFor({ [HEADER]: 'req-9', [LABEL_HEADER]: 'GET%20%2F' }))
      await vi.waitFor(() => expect(received).toHaveLength(9))
      expect(received.every(span => span.requestId === 'req-9')).toBe(true)
      expect(received.map(({ kind, name, status }) => ({ kind, name, status }))).toEqual(expect.arrayContaining([
        { kind: 'plugin', name: 'nuxt:head', status: undefined },
        { kind: 'hook', name: 'app:rendered', status: undefined },
        { kind: 'hook', name: 'app:created', status: undefined },
        { kind: 'middleware', name: 'auth', status: undefined },
        { kind: 'middleware', name: 'nuxt/dist/app/middleware/guard.js', status: undefined },
        { kind: 'data', name: 'useFetch(posts)', status: undefined },
        { kind: 'route', name: 'GET /api/posts?page=2', status: 201 },
        { kind: 'hook', name: 'render:html', status: undefined },
        { kind: 'fetch', name: 'GET https://api.example.com/data', status: 200 },
      ]))
    }
    finally {
      close()
    }
  })
})
