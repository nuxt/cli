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

  describe('narration', () => {
    function attach() {
      const progress = new DevProgress()
      let before: (event: { name: string, args?: unknown[] }) => void = () => {}
      let after: (event: { name: string }) => void = () => {}
      progress.start()
      progress.attachNuxt({
        beforeEach: fn => (before = fn),
        afterEach: fn => (after = fn),
      })
      const callHook = (name: string, ...args: unknown[]) => {
        before({ name, args })
        after({ name })
      }
      const enter = (name: string) => before({ name, args: [] })
      const leave = (name: string) => after({ name })
      callHook('modules:before')
      const install = (name: string) => callHook('module:before', { name, meta: { name } })
      const finish = (name: string) => callHook('module:done', { name, meta: { name }, duration: 1 })
      return { progress, callHook, enter, leave, install, finish }
    }

    it('should name a module that stays busy, without advancing the phase', () => {
      vi.useFakeTimers()
      const { progress, install } = attach()

      install('@nuxtjs/i18n')
      vi.advanceTimersByTime(300)

      expect(progress.snapshot.message).toBe('Setting up @nuxtjs/i18n')
      expect(progress.snapshot.phase).toBe('modules')
      expect(progress.snapshot.index).toBe(1)
      vi.useRealTimers()
    })

    it('should not name modules that install quickly', () => {
      vi.useFakeTimers()
      const { progress, install, finish } = attach()

      for (const name of ['a', 'b', 'c', 'd']) {
        install(name)
        vi.advanceTimersByTime(20)
        finish(name)
      }

      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should put the phase label back once nothing is holding the load up', () => {
      vi.useFakeTimers()
      const { progress, install, finish } = attach()

      install('slow-module')
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Setting up slow-module')

      finish('slow-module')
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should stop naming modules once the phase moves on', () => {
      vi.useFakeTimers()
      const { progress, callHook, install } = attach()

      install('slow-module')
      callHook('builder:generateApp')
      vi.advanceTimersByTime(300)

      expect(progress.snapshot.phase).toBe('app')
      expect(progress.snapshot.message).toBe('Preparing app')
      vi.useRealTimers()
    })

    it('should shorten local module paths and long names', () => {
      vi.useFakeTimers()
      const { progress, install } = attach()

      install('modules/analytics.ts')
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Setting up analytics')

      install(`@scope/${'x'.repeat(40)}`)
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toMatch(/^Setting up @scope\/x{24}\u2026$/)
      vi.useRealTimers()
    })

    it('should not name a module that finished before it earned a mention', () => {
      vi.useFakeTimers()
      const { progress, install, finish } = attach()

      install('quick-module')
      vi.advanceTimersByTime(20)
      finish('quick-module')
      vi.advanceTimersByTime(500)

      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should name a hook that outlasts its phase label', () => {
      vi.useFakeTimers()
      const { progress, enter, leave } = attach()

      enter('markdown:blog-entries')
      vi.advanceTimersByTime(1500)
      expect(progress.snapshot.message).toBe('Running markdown:blog-entries')
      expect(progress.snapshot.index).toBe(1)

      leave('markdown:blog-entries')
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should not name the thousands of hooks that return at once', () => {
      vi.useFakeTimers()
      const { progress, callHook } = attach()
      const listener = vi.fn()
      progress.onUpdate(listener)

      for (let index = 0; index < 2000; index++) {
        callHook(`some:hook:${index % 20}`)
      }
      vi.advanceTimersByTime(2000)

      expect(progress.snapshot.message).toBe('Setting up modules')
      expect(listener).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('should blame the innermost hook still running', () => {
      vi.useFakeTimers()
      const { progress, enter, leave } = attach()

      enter('outer:hook')
      vi.advanceTimersByTime(1200)
      enter('inner:hook')
      vi.advanceTimersByTime(1200)
      expect(progress.snapshot.message).toBe('Running inner:hook')

      leave('inner:hook')
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Running outer:hook')
      vi.useRealTimers()
    })

    it('should survive hooks that finish out of order', () => {
      vi.useFakeTimers()
      const { progress, enter, leave } = attach()

      enter('first:hook')
      enter('second:hook')
      leave('first:hook')
      vi.advanceTimersByTime(1200)
      expect(progress.snapshot.message).toBe('Running second:hook')

      leave('second:hook')
      leave('never:started')
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should not grow without bound when hooks never finish', () => {
      vi.useFakeTimers()
      const { progress, enter } = attach()

      for (let index = 0; index < 500; index++) {
        enter(`stuck:hook:${index}`)
      }
      vi.advanceTimersByTime(1200)

      expect(progress.snapshot.message).toBe('Running stuck:hook:499')
      vi.useRealTimers()
    })

    it('should not narrate a hook that was already running when the phase began', () => {
      vi.useFakeTimers()
      const { progress, enter, callHook } = attach()

      enter('modules:done')
      vi.advanceTimersByTime(1500)
      callHook('builder:generateApp')
      vi.advanceTimersByTime(1500)

      expect(progress.snapshot.phase).toBe('app')
      expect(progress.snapshot.message).toBe('Preparing app')
      vi.useRealTimers()
    })

    it('should count installed modules when nothing names itself', () => {
      vi.useFakeTimers()
      const progress = new DevProgress()
      let installed = 0
      progress.start()
      progress.attachNuxt({ beforeEach: fn => fn({ name: 'modules:before' }), afterEach: () => {} }, { installedModules: () => installed })

      vi.advanceTimersByTime(4000)
      expect(progress.snapshot.message).toBe('Setting up modules')

      installed = 7
      vi.advanceTimersByTime(250)
      expect(progress.snapshot.message).toBe('Setting up modules · 7 installed')
      vi.useRealTimers()
    })

    it('should give an internal hook a label rather than its own name', () => {
      vi.useFakeTimers()
      const { progress, enter } = attach()

      enter('app:templatesGenerated')
      vi.advanceTimersByTime(1500)

      expect(progress.snapshot.message).toBe('Writing app templates')
      vi.useRealTimers()
    })

    it('should stay on the phase label for an unlabelled internal hook', () => {
      vi.useFakeTimers()
      const { progress, enter } = attach()

      enter('build:manifest')
      vi.advanceTimersByTime(3000)

      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should name whatever is running once a phase stops explaining itself', () => {
      vi.useFakeTimers()
      const { progress, enter } = attach()

      vi.advanceTimersByTime(4000)
      enter('markdown:blog-entries')
      vi.advanceTimersByTime(250)

      expect(progress.snapshot.message).toBe('Running markdown:blog-entries')
      vi.useRealTimers()
    })

    it('should report how long the current phase has been running', () => {
      vi.useFakeTimers()
      const { progress, callHook } = attach()

      vi.advanceTimersByTime(2000)
      callHook('prepare:types')
      vi.advanceTimersByTime(33_000)

      expect(progress.snapshot.phase).toBe('types')
      expect(progress.snapshot.phaseElapsed).toBe(33_000)
      expect(progress.snapshot.elapsed).toBe(35_000)
      vi.useRealTimers()
    })

    it('should leave a hook that owns a phase described by that phase', () => {
      vi.useFakeTimers()
      const { progress, enter } = attach()

      enter('builder:generateApp')
      vi.advanceTimersByTime(3000)

      expect(progress.snapshot.message).toBe('Preparing app')
      vi.useRealTimers()
    })

    it('should give known slow steps a friendlier label than their hook name', () => {
      vi.useFakeTimers()
      const { progress, enter } = attach()

      enter('devtools:before')
      vi.advanceTimersByTime(1200)

      expect(progress.snapshot.message).toBe('Setting up Nuxt DevTools')
      vi.useRealTimers()
    })

    it('should name the nitro hook a server build is waiting on', () => {
      vi.useFakeTimers()
      const { progress, callHook, enter } = attach()
      let nitroBefore: (event: { name: string }) => void = () => {}
      let nitroAfter: (event: { name: string }) => void = () => {}
      const nitro = {
        hooks: {
          beforeEach: (fn: (event: { name: string }) => void) => (nitroBefore = fn),
          afterEach: (fn: (event: { name: string }) => void) => (nitroAfter = fn),
        },
      }

      callHook('nitro:init', nitro)
      enter('nitro:build:before')
      nitroBefore({ name: 'rollup:before' })
      vi.advanceTimersByTime(1500)
      expect(progress.snapshot.message).toBe('Bundling the server')
      expect(progress.snapshot.phase).toBe('server')

      nitroAfter({ name: 'rollup:before' })
      vi.advanceTimersByTime(300)
      expect(progress.snapshot.message).toBe('Building server')
      vi.useRealTimers()
    })

    it('should not let a hook of one system pop the entry of the other', () => {
      vi.useFakeTimers()
      const { progress, callHook, enter } = attach()
      let nitroBefore: (event: { name: string }) => void = () => {}
      const nitro = {
        hooks: {
          beforeEach: (fn: (event: { name: string }) => void) => (nitroBefore = fn),
          afterEach: () => {},
        },
      }

      callHook('nitro:init', nitro)
      enter('rollup:before')
      nitroBefore({ name: 'rollup:before' })
      vi.advanceTimersByTime(1500)

      expect(progress.snapshot.message).toBe('Bundling the server')
      vi.useRealTimers()
    })

    it('should carry on when nitro is never initialised', () => {
      vi.useFakeTimers()
      const { progress, callHook } = attach()

      callHook('nitro:init', undefined)
      callHook('nitro:init', { hooks: {} })
      vi.advanceTimersByTime(1500)

      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })

    it('should stay silent on a nuxt whose hooks cannot be timed', () => {
      vi.useFakeTimers()
      const progress = new DevProgress()
      let before: (event: { name: string, args?: unknown[] }) => void = () => {}
      progress.start()
      progress.attachNuxt({ beforeEach: fn => (before = fn) })

      before({ name: 'modules:before' })
      before({ name: 'markdown:blog-entries' })
      vi.advanceTimersByTime(5000)

      expect(progress.snapshot.message).toBe('Setting up modules')
      vi.useRealTimers()
    })
  })

  describe('the wait after the server is ready', () => {
    it('should hold short of complete until a request has been answered', () => {
      const progress = new DevProgress()
      progress.start()
      const { res } = createResponse()
      progress.handleRequest(request(PROGRESS_PATH), res)

      progress.setReady()
      expect(progress.snapshot.serving).toBe(false)
      expect(progress.snapshot.progress).toBe(0.95)
      expect(progress.snapshot.message).toBe('Compiling the first request')

      progress.setServing()
      expect(progress.snapshot.serving).toBe(true)
      expect(progress.snapshot.progress).toBe(1)
      expect(progress.snapshot.message).toBe('Ready')
    })

    it('should not wait for a render nobody is waiting for', () => {
      const progress = new DevProgress()
      progress.start()
      progress.setReady()

      expect(progress.snapshot.serving).toBe(true)
      expect(progress.snapshot.progress).toBe(1)
    })

    it('should stop waiting once the page that was waiting has gone', () => {
      const progress = new DevProgress()
      progress.start()
      const { res, close } = createResponse()
      progress.handleRequest(request(PROGRESS_PATH), res)
      progress.setReady()

      close()
      expect(progress.snapshot.serving).toBe(true)
    })

    it('should ignore a render reported before the server is ready', () => {
      const progress = new DevProgress()
      progress.start()
      progress.setServing()

      expect(progress.snapshot.serving).toBe(false)
      expect(progress.snapshot.status).toBe('loading')
    })

    it('should wait again for the first render of a reload', () => {
      const progress = new DevProgress()
      progress.start()
      const { res } = createResponse()
      progress.handleRequest(request(PROGRESS_PATH), res)
      progress.setReady()
      progress.setServing()

      progress.start('nuxt.config.ts changed. Reloading Nuxt...', true)
      progress.setReady()

      expect(progress.snapshot.serving).toBe(false)
    })
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
