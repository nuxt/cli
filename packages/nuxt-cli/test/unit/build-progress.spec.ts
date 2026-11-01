import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { describe, expect, it } from 'vitest'

import { BuildProgress } from '../../src/utils/build-progress'

type HookHandler = (event: { name: string, args?: unknown[] }) => void

interface VitePlugin {
  configResolved: (config: { build?: { ssr?: unknown } }) => void
  buildStart: (this: { environment?: { name: string } }) => void
  closeBundle: (this: { environment?: { name: string } }) => void
}

function nuxtStub() {
  const handlers: HookHandler[] = []
  const nitroHandlers: HookHandler[] = []
  return {
    nuxt: {
      hooks: { beforeEach: (fn: HookHandler) => void handlers.push(fn) },
    },
    call(name: string, ...args: unknown[]) {
      for (const handler of handlers) {
        handler({ name, args })
      }
    },
    extendVite() {
      const config: { plugins?: VitePlugin[] } = {}
      this.call('vite:extend', { config })
      return config.plugins![0]!
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
    const plugin = stub.extendVite()
    plugin.configResolved({ build: {} })
    plugin.buildStart.call({})
    plugin.closeBundle.call({})
    plugin.configResolved({ build: { ssr: true } })
    plugin.buildStart.call({})
    plugin.closeBundle.call({})
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

  it('should time each bundle when Vite builds every environment in one run', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    const seen = messages(progress)

    stub.call('build:before')
    const plugin = stub.extendVite()
    stub.call('vite:configResolved', {}, { isClient: true, isServer: false })
    stub.call('vite:configResolved', {}, { isClient: false, isServer: true })
    stub.call('nitro:build:before', {})
    expect(seen).toEqual(['Loading Nuxt config', 'Bundling client'])

    for (const name of ['client', 'ssr', 'nitro']) {
      plugin.buildStart.call({ environment: { name } })
      plugin.closeBundle.call({ environment: { name } })
    }
    progress.finish()

    expect(seen).toEqual(['Loading Nuxt config', 'Bundling client', 'Bundling server', 'Building Nitro server'])
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'client', 'server', 'nitro'])
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
