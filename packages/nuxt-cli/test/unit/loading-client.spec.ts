import type { ProgressClientOptions } from '../../src/dev/loading-client'
import type { DevProgressSnapshot } from '../../src/dev/progress'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { inlineScript, progressClient } from '../../src/dev/loading-client'

const OPTIONS: ProgressClientOptions = {
  progressPath: '/__nuxt_dev__/progress',
  captionId: 'nuxt-dev-phase',
  progressProperty: '--nuxt-progress',
  elapsed: 0,
  pollInterval: 200,
  maxPollInterval: 1000,
}

function snapshot(overrides: Partial<DevProgressSnapshot> = {}): DevProgressSnapshot {
  return {
    status: 'loading',
    phase: 'bundle',
    message: 'Bundling app',
    index: 4,
    total: 6,
    progress: 0.5,
    elapsed: 1200,
    reload: false,
    serving: false,
    timings: [],
    ...overrides,
  }
}

interface FakeElement {
  id: string
  title: string
  src?: string
  textContent: string
  removeAttribute: (name: string) => void
}

/**
 * Run the script exactly as the browser would: from the serialised string, in a
 * scope of its own. A reference to anything the bundler renamed would throw
 * here rather than in someone's browser.
 */
function run(options: Partial<ProgressClientOptions> = {}, fetchImpl?: typeof fetch) {
  const listeners = new Map<string, (event: { data: string }) => void>()
  const elements: FakeElement[] = []
  const classes = new Set<string>()
  const classList = { add: (name: string) => void classes.add(name), remove: (name: string) => void classes.delete(name) }
  const properties = new Map<string, string>()
  const reload = vi.fn()
  const close = vi.fn()

  vi.stubGlobal('document', {
    title: '',
    documentElement: { style: { setProperty: (name: string, value: string) => void properties.set(name, value) } },
    body: { append: (element: FakeElement) => void elements.push(element), classList },
    createElement: (): FakeElement => ({ id: '', title: '', textContent: '', removeAttribute: () => {} }),
  })
  const sources: { readyState: number }[] = []
  vi.stubGlobal('EventSource', class {
    readyState = 0
    constructor(readonly url: string) {
      sources.push(this)
    }

    close = close
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      listeners.set(type, listener)
    }
  })
  vi.stubGlobal('location', { href: 'http://localhost:3000/', reload })
  const request = vi.fn(fetchImpl ?? (() => Promise.resolve({ text: () => Promise.resolve('') } as Response)))
  vi.stubGlobal('fetch', request)

  const script = inlineScript(progressClient, { ...OPTIONS, ...options })
  // eslint-disable-next-line no-new-func
  new Function(script.replace(/^<script>|<\/script>$/g, ''))()

  return {
    elements,
    classes,
    properties,
    reload,
    close,
    request,
    emit: (type: string, data: unknown) => listeners.get(type)?.({ data: JSON.stringify(data) }),
    listens: (type: string) => listeners.has(type),
  }
}

describe('the injected progress client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('should run standalone, with nothing but its options', () => {
    const client = run()

    expect(client.elements.map(element => element.id)).toEqual(['nuxt-dev-phase'])
    expect(client.listens('nuxt:loading')).toBe(true)
    expect(client.listens('nuxt:error')).toBe(true)
    expect(client.listens('nuxt:ready')).toBe(true)
  })

  it('should report the phase, the step and the elapsed time', () => {
    const client = run()
    client.emit('nuxt:loading', snapshot())

    expect(client.elements[0]!.textContent).toMatch(/^bundling app · step 5\/7 · \d+\.\ds$/)
    expect(client.properties.get('--nuxt-progress')).toBe('50%')
    expect(document.title).toBe('Bundling app')
  })

  it('should surface the module being set up, in the caption and the tab title', () => {
    const client = run()
    client.emit('nuxt:loading', snapshot({ index: 1, phase: 'modules', message: 'Setting up @nuxtjs/i18n', progress: 1 / 6 }))

    expect(client.elements[0]!.textContent).toMatch(/^setting up @nuxtjs\/i18n · step 2\/7 · \d+\.\ds$/)
    expect(document.title).toBe('Setting up @nuxtjs/i18n')
  })

  it('should hand a build error over to the error page', () => {
    const client = run()
    client.emit('nuxt:error', snapshot({ status: 'error' }))

    expect(client.close).toHaveBeenCalled()
    expect(client.reload).toHaveBeenCalled()
  })

  it('should reload at once after a reload, where nothing is left to warm up', () => {
    const client = run()
    client.emit('nuxt:ready', snapshot({ status: 'ready', reload: true, progress: 0.95 }))

    expect(client.properties.get('--nuxt-progress')).toBe('100%')
    expect(client.close).toHaveBeenCalled()
    expect(client.reload).toHaveBeenCalled()
  })

  it('should wait for the app rather than reloading into a cold start', async () => {
    const client = run({ pollInterval: 1 })
    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 0.95, message: 'Compiling the first request' }))

    expect(client.reload).not.toHaveBeenCalled()
    expect(client.elements[0]!.textContent).toMatch(/^compiling the first request · /)

    await vi.waitFor(() => expect(client.reload).toHaveBeenCalled())
    expect(client.request).toHaveBeenCalledWith('http://localhost:3000/', expect.objectContaining({ headers: { accept: 'text/html' } }))
  })

  it('should say it is starting the app in the tab title as well as the caption', () => {
    const client = run()
    client.emit('nuxt:loading', snapshot())
    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 0.95, message: 'Compiling the first request' }))

    expect(document.title).toBe('Compiling the first request')
    expect(client.elements[0]!.textContent).toMatch(/^compiling the first request · /)
  })

  it('should hold the bar short of full while the server is still not serving', () => {
    const client = run()
    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 0.95 }))

    expect(client.properties.get('--nuxt-progress')).toBe('95%')
  })

  it('should fill the bar when the snapshot says nothing useful about progress', () => {
    const client = run()
    client.emit('nuxt:ready', undefined)

    expect(client.properties.get('--nuxt-progress')).toBe('100%')
  })

  it('should never have more than one request for the app in flight', async () => {
    vi.useFakeTimers()
    let pending = 0
    let peak = 0
    const client = run({}, () => {
      peak = Math.max(peak, ++pending)
      return new Promise(resolve => setTimeout(() => {
        pending--
        resolve({ text: () => Promise.resolve('<div id="nuxt-dev-phase"></div>') } as Response)
      }, 5000))
    })

    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 1 }))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(peak).toBe(1)
    expect(client.request.mock.calls.length).toBeLessThan(12)
    expect(client.reload).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('should back off towards the ceiling between attempts', async () => {
    vi.useFakeTimers()
    const at: number[] = []
    const started = Date.now()
    const client = run({}, () => {
      at.push(Date.now() - started)
      return Promise.resolve({ text: () => Promise.resolve('<div id="nuxt-dev-phase"></div>') } as Response)
    })

    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 1 }))
    await vi.advanceTimersByTimeAsync(5000)

    expect(at.slice(0, 6)).toEqual([0, 200, 500, 950, 1625, 2625])
    vi.useRealTimers()
  })

  it('should stop polling and reload once, aborting whatever is in flight', async () => {
    vi.useFakeTimers()
    const signals: (AbortSignal | undefined)[] = []
    const client = run({}, (_input, init) => {
      signals.push(init?.signal ?? undefined)
      return Promise.resolve({ text: () => Promise.resolve('<html>the app</html>') } as Response)
    })

    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 1 }))
    await vi.advanceTimersByTimeAsync(30_000)

    expect(client.reload).toHaveBeenCalledTimes(1)
    expect(client.request).toHaveBeenCalledTimes(1)
    expect(signals[0]!.aborted).toBe(true)
    vi.useRealTimers()
  })
})
