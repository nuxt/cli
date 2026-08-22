import { BroadcastChannel } from 'node:worker_threads'

import { describe, expect, it, vi } from 'vitest'

import { DEV_LOG_CHANNEL, openDevLogChannel } from '../../src/dev/log-channel'

const reporters: Array<{ log: (logObj: unknown) => void }> = []
vi.mock('consola', () => ({
  consola: { addReporter: (reporter: { log: (logObj: unknown) => void }) => reporters.push(reporter) },
}))

const { default: plugin } = await import('../../runtime/dev-request-context.mjs') as {
  default: (nitroApp: unknown) => void
}

const HEADER = 'x-nuxt-dev-request-id'

function nitroApp(handler: (event: unknown) => unknown) {
  const app = { handler: Object.assign(handler, { __is_handler__: true }) }
  return { app, nitroApp: { h3App: app } }
}

function eventFor(headers: Record<string, string> = {}) {
  return { node: { req: { headers, url: '/api/hello' } } }
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
    expect(app.handler(eventFor({ [HEADER]: '7 GET /api/hello' }))).toBe('served')
    expect(app.handler(eventFor({ [HEADER]: 'nonsense' }))).toBe('served')
  })

  it('does not leave its own header on the request', () => {
    const { app, nitroApp: instance } = nitroApp(() => 'served')
    plugin(instance)
    const event = eventFor({ [HEADER]: '7 GET /api/hello' })
    app.handler(event)
    expect(event.node.req.headers[HEADER]).toBeUndefined()
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
      expect(app.handler(eventFor({ [HEADER]: '7 GET /api/hello' }))).toBe('served')
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
      app.handler(eventFor({ [HEADER]: '42 GET /api/hello' }))
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({
        message: 'from the app',
        origin: 'runtime',
        request: 'GET /api/hello',
        requestId: 42,
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

    const received: Array<{ origin: string, requestId?: number }> = []
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
})
