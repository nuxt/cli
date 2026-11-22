import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BuildProgress } from '../../src/utils/build-progress'

type HookHandler = (event: { name: string, args?: unknown[] }) => void

function nuxtStub() {
  const handlers: HookHandler[] = []
  return {
    nuxt: {
      hooks: {
        beforeEach: (fn: HookHandler) => void handlers.push(fn),
      },
    },
    call(name: string) {
      for (const handler of handlers) {
        handler({ name })
      }
    },
  }
}

function track(progress: BuildProgress): ProgressSnapshot[] {
  const seen: ProgressSnapshot[] = []
  progress.onUpdate(snapshot => seen.push(snapshot))
  return seen
}

describe('build progress', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should follow the phases of a production build', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    const seen = track(progress)

    stub.call('modules:before')
    stub.call('builder:generateApp')
    stub.call('prepare:types')
    stub.call('build:before')
    progress.startBundle('client')
    progress.endBundle('client')
    progress.startBundle('server')
    progress.endBundle('server')
    progress.startPrerender()
    progress.endPrerender()
    progress.startBundle('nitro')
    progress.endBundle('nitro')
    progress.finish()

    expect(seen.map(snapshot => snapshot.message)).toEqual([
      'Loading Nuxt config',
      'Setting up modules',
      'Preparing app',
      'Generating types',
      'Building',
      'Bundling client',
      'Building',
      'Bundling server',
      'Building',
      'Prerendering routes',
      'Building',
      'Bundling nitro',
      'Building',
    ])
    expect(progress.timings.map(timing => timing.phase)).toEqual([
      'config',
      'modules',
      'app',
      'types',
      'client',
      'server',
      'prerender',
      'nitro',
    ])
  })

  it('should report bundles that build at the same time', () => {
    const progress = new BuildProgress()
    const seen = track(progress)

    progress.startBundle('client')
    vi.advanceTimersByTime(5)
    progress.startBundle('server')
    vi.advanceTimersByTime(200)
    progress.endBundle('server')
    vi.advanceTimersByTime(100)
    progress.endBundle('client')
    progress.finish()

    expect(seen.map(snapshot => snapshot.message)).toEqual([
      'Loading Nuxt config',
      'Bundling client',
      'Bundling client and server',
      'Bundling client',
      'Building',
    ])
    expect(progress.timings.filter(timing => timing.phase !== 'config')).toEqual([
      {
        phase: 'client',
        message: 'client',
        start: 0,
        duration: 305,
      },
      {
        phase: 'server',
        message: 'server',
        start: 5,
        duration: 200,
      },
    ])
    expect(progress.phaseTimings.map(timing => [timing.phase, timing.duration])).toEqual([
      ['config', 0],
      ['build', 305],
    ])
  })

  it('should keep the phase of the last task between tasks', () => {
    const progress = new BuildProgress()
    const seen = track(progress)

    progress.startBundle('client')
    progress.endBundle('client')

    expect(seen.at(-1)).toMatchObject({ phase: 'bundle:client', message: 'Building' })
  })

  it('should count prerendered routes against the routes found so far', () => {
    const progress = new BuildProgress()
    const seen = track(progress)

    progress.startPrerender(1)
    progress.prerenderRoute('/', 4)
    progress.prerenderRoute('/about', 4)
    progress.prerenderRoute('/blog', 2)

    expect(seen.slice(1).map(snapshot => [snapshot.message, snapshot.meter])).toEqual([
      [
        'Prerendering routes',
        { done: 0, total: 1 },
      ],
      [
        'Prerendering routes',
        { done: 1, total: 4, detail: '/' },
      ],
      [
        'Prerendering routes',
        { done: 2, total: 4, detail: '/about' },
      ],
      [
        'Prerendering routes',
        { done: 3, total: 4, detail: '/blog' },
      ],
    ])
  })

  it('should never count more routes done than known', () => {
    const progress = new BuildProgress()
    const seen = track(progress)

    progress.startPrerender()
    progress.prerenderRoute('/')
    progress.prerenderRoute('/about')

    expect(seen.at(-1)!.meter).toEqual({ done: 2, total: 2, detail: '/about' })
  })

  it('should only carry a meter while prerendering', () => {
    const progress = new BuildProgress()
    const seen = track(progress)

    progress.startBundle('client')
    progress.startPrerender(3)
    progress.endPrerender()

    expect(seen.map(snapshot => snapshot.meter)).toEqual([
      undefined,
      undefined,
      { done: 0, total: 3 },
      undefined,
    ])
  })

  it('should time the build as one phase when no bundles are reported', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)

    stub.call('build:before')
    progress.finish()

    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'build'])
  })

  it('should keep phase durations after the build is finished', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)

    stub.call('modules:before')
    progress.finish()
    progress.finish()
    progress.startBundle('client')

    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules'])
    expect(progress.snapshot.phase).toBe('modules')
  })
})
