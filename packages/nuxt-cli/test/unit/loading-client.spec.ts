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
function run(options: Partial<ProgressClientOptions> = {}) {
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
  vi.stubGlobal('EventSource', class {
    constructor(readonly url: string) {}
    close = close
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      listeners.set(type, listener)
    }
  })
  vi.stubGlobal('location', { href: 'http://localhost:3000/', reload })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ text: () => Promise.resolve('') })))

  const script = inlineScript(progressClient, { ...OPTIONS, ...options })
  // eslint-disable-next-line no-new-func
  new Function(script.replace(/^<script>|<\/script>$/g, ''))()

  return {
    elements,
    classes,
    properties,
    reload,
    close,
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

    expect(client.elements[0]!.textContent).toMatch(/^bundle · step 5\/7 · \d+\.\ds$/)
    expect(client.properties.get('--nuxt-progress')).toBe('50%')
    expect(document.title).toBe('Bundling app')
  })

  it('should hand a build error over to the error page', () => {
    const client = run()
    client.emit('nuxt:error', snapshot({ status: 'error' }))

    expect(client.close).toHaveBeenCalled()
    expect(client.reload).toHaveBeenCalled()
  })

  it('should reload at once after a reload, where nothing is left to warm up', () => {
    const client = run()
    client.emit('nuxt:ready', snapshot({ status: 'ready', reload: true, progress: 1 }))

    expect(client.close).toHaveBeenCalled()
    expect(client.reload).toHaveBeenCalled()
  })

  it('should wait for the app rather than reloading into a cold start', async () => {
    const client = run({ pollInterval: 1 })
    client.emit('nuxt:ready', snapshot({ status: 'ready', progress: 1 }))

    expect(client.reload).not.toHaveBeenCalled()
    expect(client.elements[0]!.textContent).toMatch(/^starting the app · /)

    await vi.waitFor(() => expect(client.reload).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/', { headers: { accept: 'text/html' } })
  })
})
