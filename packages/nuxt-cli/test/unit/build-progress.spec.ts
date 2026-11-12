import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { describe, expect, it } from 'vitest'

import { BuildProgress } from '../../src/utils/build-progress'

type HookHandler = (event: { name: string, args?: unknown[] }) => void

function nuxtStub(options: { nitroViteEnvironment?: boolean } = {}) {
  const handlers: HookHandler[] = []
  const nitroHandlers: HookHandler[] = []
  return {
    nuxt: {
      options: { experimental: { nitroViteEnvironment: options.nitroViteEnvironment } },
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
    stub.call('nitro:init', stub.nitro)
    const seen = messages(progress)

    stub.call('modules:before')
    stub.call('builder:generateApp')
    stub.call('prepare:types')
    stub.call('build:before')
    progress.enterEnvironment({ name: 'client', consumer: 'client' })
    progress.enterEnvironment({ name: 'ssr', consumer: 'server' })
    stub.call('nitro:build:before', {})
    stub.callNitro('prerender:init')
    stub.callNitro('rollup:before')
    progress.finish()

    expect(seen).toEqual([
      'Loading Nuxt config',
      'Setting up modules',
      'Preparing app',
      'Generating types',
      'Bundling client',
      'Bundling server',
      'Prerendering routes',
      'Bundling nitro',
    ])
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules', 'app', 'types', 'bundle (client)', 'bundle (server)', 'prerender', 'bundle (nitro)'])
  })

  it('should ignore Nitro\'s hooks until Nuxt starts the Nitro build', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    stub.call('nitro:init', stub.nitro)
    const seen = messages(progress)

    // Nitro runs its Rollup hooks while Nuxt is still bundling the app.
    stub.call('build:before')
    stub.callNitro('rollup:before')
    progress.enterEnvironment({ name: 'ssr', consumer: 'server' })

    expect(seen).toEqual(['Loading Nuxt config', 'Bundling client', 'Bundling server'])
  })

  it('should take the Nitro phase from its Vite environment when Nitro builds with Vite', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub({ nitroViteEnvironment: true })
    progress.attachNuxt(stub.nuxt)
    stub.call('nitro:init', stub.nitro)
    const seen = messages(progress)

    // Nitro 3 starts its build before Vite bundles the app.
    stub.call('nitro:build:before', {})
    stub.callNitro('rollup:before')
    progress.enterEnvironment({ name: 'client', consumer: 'client' })
    progress.enterEnvironment({ name: 'ssr', consumer: 'server' })
    stub.callNitro('prerender:init')
    progress.enterEnvironment({ name: 'nitro', consumer: 'server' })
    progress.finish()

    expect(seen).toEqual(['Loading Nuxt config', 'Bundling client', 'Bundling server', 'Prerendering routes', 'Bundling nitro'])
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'bundle (client)', 'bundle (server)', 'prerender', 'bundle (nitro)'])
  })

  it('should count prerendered routes', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    stub.call('nitro:init', stub.nitro)
    const seen = messages(progress)

    stub.call('nitro:build:before', {})
    stub.callNitro('prerender:init')
    stub.callNitro('prerender:generate', { route: '/about' })
    stub.callNitro('prerender:route', { route: '/about' })
    stub.callNitro('prerender:generate', { route: '/blog' })

    expect(seen).toEqual(['Loading Nuxt config', 'Prerendering routes', 'Prerendering /about', 'Prerendering /blog (1 done)'])
  })

  it('should keep phase durations after the build is finished', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)

    stub.call('modules:before')
    progress.finish()
    progress.finish()
    progress.enterEnvironment({ name: 'client', consumer: 'client' })

    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules'])
    expect(progress.snapshot.phase).toBe('modules')
  })
})
