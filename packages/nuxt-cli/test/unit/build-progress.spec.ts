import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { describe, expect, it } from 'vitest'

import { BuildProgress } from '../../src/utils/build-progress'

type HookHandler = (event: { name: string, args?: unknown[] }) => void

function nuxtStub(options: { viteEnvironmentApi?: boolean } = {}) {
  const handlers: HookHandler[] = []
  const nitroHandlers: HookHandler[] = []
  return {
    nuxt: {
      options: { experimental: { viteEnvironmentApi: options.viteEnvironmentApi } },
      hooks: { beforeEach: (fn: HookHandler) => void handlers.push(fn) },
    },
    call(name: string, ...args: unknown[]) {
      for (const handler of handlers) {
        handler({ name, args })
      }
    },
    nitro: { hooks: { beforeEach: (fn: HookHandler) => void nitroHandlers.push(fn) } },
    callNitro(name: string, ...args: unknown[]) {
      for (const handler of nitroHandlers) {
        handler({ name, args })
      }
    },
  }
}

function messages(progress: BuildProgress): string[] {
  const seen: string[] = []
  progress.onUpdate((snapshot: ProgressSnapshot) => seen.push(snapshot.message))
  return seen
}

describe('build progress', () => {
  it('should follow the phases of a production build', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    const seen = messages(progress)

    stub.call('modules:before')
    stub.call('builder:generateApp')
    stub.call('prepare:types')
    stub.call('build:before')
    stub.call('vite:configResolved', {}, { isClient: true, isServer: false })
    stub.call('vite:configResolved', {}, { isClient: false, isServer: true })
    stub.call('nitro:build:before', {})
    progress.finish()

    expect(seen).toEqual([
      'Loading Nuxt config',
      'Setting up modules',
      'Preparing app',
      'Generating types',
      'Bundling client',
      'Bundling server',
      'Building Nitro server',
    ])
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules', 'app', 'types', 'client', 'server', 'nitro'])
  })

  it('should not split the bundle phase when a single build covers both environments', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub({ viteEnvironmentApi: true })
    progress.attachNuxt(stub.nuxt)
    const seen = messages(progress)

    stub.call('build:before')
    stub.call('vite:configResolved', {}, { isClient: true, isServer: false })
    stub.call('vite:configResolved', {}, { isClient: false, isServer: true })

    expect(seen).toEqual(['Loading Nuxt config', 'Bundling app'])
  })

  it('should name what the Nitro phase is doing', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    stub.call('nitro:init', stub.nitro)
    const seen = messages(progress)

    stub.callNitro('rollup:before')
    stub.call('nitro:build:before', {})
    stub.callNitro('rollup:before')
    stub.callNitro('prerender:generate', { route: '/about' })

    expect(seen).toEqual(['Loading Nuxt config', 'Building Nitro server', 'Bundling Nitro server', 'Prerendering /about'])
  })

  it('should keep phase durations after the build is finished', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)

    stub.call('modules:before')
    progress.finish()
    progress.finish()
    stub.call('nitro:build:before', {})

    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules'])
    expect(progress.snapshot.phase).toBe('modules')
  })
})
