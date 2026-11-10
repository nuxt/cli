import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { describe, expect, it } from 'vitest'

import { BuildProgress } from '../../src/utils/build-progress'

type HookHandler = (event: { name: string, args?: unknown[] }) => void

interface VitePlugin {
  name: string
  configResolved: (config: { build?: { ssr?: unknown } }) => void
  buildStart: (this: { environment?: { config: { consumer: string } } }) => void
}

function nuxtStub() {
  const handlers: HookHandler[] = []
  const nitroHandlers: HookHandler[] = []
  const extendConfig: Array<(config: { plugins: unknown[] }) => void> = []
  return {
    nuxt: {
      hook: (_name: 'vite:extendConfig', fn: (config: { plugins: unknown[] }) => void) => void extendConfig.push(fn),
      hooks: { beforeEach: (fn: HookHandler) => void handlers.push(fn) },
    },
    call(name: string, ...args: unknown[]) {
      for (const handler of handlers) {
        handler({ name, args })
      }
    },
    /** Run `vite:extendConfig` on a config and return the plugins the CLI added to it. */
    extendVite(config: { plugins: unknown[] }): VitePlugin[] {
      for (const fn of extendConfig) {
        fn(config)
      }
      return config.plugins as VitePlugin[]
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
    // Without the environment API, client and server each have a config and a build.
    const [client] = stub.extendVite({ plugins: [] })
    const [server] = stub.extendVite({ plugins: [] })
    client!.configResolved({ build: {} })
    server!.configResolved({ build: { ssr: true } })
    client!.buildStart.call({})
    server!.buildStart.call({})
    stub.call('nitro:build:before', {})
    progress.finish()

    expect(seen).toEqual([
      'Loading Nuxt config',
      'Setting up modules',
      'Preparing app',
      'Generating types',
      'Bundling client',
      'Bundling server',
      'Bundling nitro',
    ])
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'modules', 'app', 'types', 'bundle (client)', 'bundle (server)', 'bundle (nitro)'])
  })

  it('should split the bundle phase when a single config builds both environments', () => {
    const progress = new BuildProgress()
    const stub = nuxtStub()
    progress.attachNuxt(stub.nuxt)
    const seen = messages(progress)

    stub.call('build:before')
    // The environment API extends one shared config once per environment, up front.
    const config = { plugins: [] }
    stub.extendVite(config)
    const plugins = stub.extendVite(config)
    expect(plugins).toHaveLength(1)
    expect(seen.at(-1)).toBe('Bundling client')

    plugins[0]!.configResolved({ build: {} })
    plugins[0]!.buildStart.call({ environment: { config: { consumer: 'client' } } })
    plugins[0]!.buildStart.call({ environment: { config: { consumer: 'server' } } })
    progress.finish()

    expect(seen).toEqual(['Loading Nuxt config', 'Bundling client', 'Bundling server'])
    expect(progress.timings.map(timing => timing.phase)).toEqual(['config', 'bundle (client)', 'bundle (server)'])
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
    stub.callNitro('prerender:route', { route: '/about' })
    stub.callNitro('prerender:generate', { route: '/blog' })

    expect(seen).toEqual(['Loading Nuxt config', 'Bundling nitro', 'Prerendering /about', 'Prerendering /blog (1 done)'])
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
