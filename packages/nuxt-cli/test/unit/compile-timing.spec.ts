import type { DevRequestSpan } from '../../src/dev/span-channel'

import { tracingChannel } from 'node:diagnostics_channel'
import { afterEach, describe, expect, it } from 'vitest'

import { shortenModuleId, subscribeCompileTiming } from '../../src/dev/compile-timing'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function selfTotal(span: DevRequestSpan): number {
  return Object.values(span.plugins ?? {}).reduce((sum, time) => sum + time, 0)
}

const modules = tracingChannel('vite.module')
const plugins = tracingChannel('vite.plugin')
const nuxtModules = tracingChannel('nuxt.bundler.module')
const nuxtPlugins = tracingChannel('nuxt.bundler.plugin')

function plugin<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return plugins.tracePromise(fn, { plugin: name, hook: 'transform' })
}

/** Compile a module the way the bundler would: a transform that resolves a dependency. */
function compile(id: string) {
  return modules.tracePromise(async () => {
    await plugin('transformer', async () => {
      await plugin('resolver', () => sleep(20))
      await sleep(20)
    })
    return { id }
  }, { url: id, environment: 'ssr' })
}

let unsubscribe: (() => void) | undefined
afterEach(() => unsubscribe?.())

function subscribe(inflight: Array<{ id: string, internal: boolean }>, current?: { id: string }) {
  const spans: DevRequestSpan[] = []
  unsubscribe = subscribeCompileTiming({ rootDir: () => '/project', current: () => current, inflight: () => inflight, report: span => spans.push(span) })
  return spans
}

describe('compile timing', () => {
  it('charges a module to the app request in flight, with each plugin\'s own time', async () => {
    const spans = subscribe([{ id: 'r1', internal: false }, { id: 'bundler', internal: true }])
    await compile('/project/app/pages/index.vue?macro=true')

    expect(spans).toHaveLength(1)
    const [span] = spans
    expect(span).toMatchObject({ requestId: 'r1', kind: 'compile', name: 'app/pages/index.vue', environment: 'ssr' })
    expect(span!.shared).toBeUndefined()
    expect(span!.plugins!.resolver).toBeGreaterThanOrEqual(15)
    expect(span!.plugins!.transformer).toBeGreaterThanOrEqual(15)
    expect(selfTotal(span!)).toBeLessThanOrEqual(span!.duration + 1)
  })

  it('keeps concurrent modules apart', async () => {
    const spans = subscribe([{ id: 'r1', internal: false }])
    await Promise.all([compile('/project/a.ts'), compile('/project/b.ts')])
    expect(spans.map(span => span.name).sort()).toEqual(['a.ts', 'b.ts'])
    for (const span of spans) {
      expect(Object.keys(span.plugins!).sort()).toEqual(['resolver', 'transformer'])
      expect(selfTotal(span)).toBeLessThanOrEqual(span.duration + 1)
    }
  })

  it('charges a module compiled while serving a request to that request alone', async () => {
    const spans = subscribe([{ id: 'r1', internal: false }, { id: 'r2', internal: false }], { id: 'asset' })
    await compile('/project/app/app.vue')
    expect(spans.map(span => [span.requestId, span.shared])).toEqual([['asset', undefined]])
  })

  it('reads the channels Nuxt publishes, and reports a module traced on both once', async () => {
    const spans = subscribe([{ id: 'r1', internal: false }])
    await nuxtModules.tracePromise(async () => {
      await nuxtPlugins.tracePromise(() => sleep(20), { plugin: 'nuxt:only', hook: 'transform' })
    }, { id: '/project/app/app.vue', environment: 'ssr' })
    await nuxtModules.tracePromise(() => compile('/project/server/api/hello.ts'), { id: '/project/server/api/hello.ts', environment: 'ssr' })

    expect(spans.map(span => span.name)).toEqual(['app/app.vue', 'server/api/hello.ts'])
    expect(spans[0]!.plugins!['nuxt:only']).toBeGreaterThanOrEqual(15)
    expect(Object.keys(spans[1]!.plugins!).sort()).toEqual(['resolver', 'transformer'])
  })

  it('marks a module compiled while several app requests are in flight as shared', async () => {
    const spans = subscribe([{ id: 'r1', internal: false }, { id: 'r2', internal: false }])
    await compile('/project/server/api/hello.ts')
    expect(spans.map(span => [span.requestId, span.shared])).toEqual([['r1', true], ['r2', true]])
  })

  it('reports nothing when no app request is in flight, or once unsubscribed', async () => {
    const spans = subscribe([])
    await compile('/project/app/app.vue')
    expect(spans).toHaveLength(0)
    unsubscribe!()
    await compile('/project/app/app.vue')
    expect(spans).toHaveLength(0)
  })

  it('names modules from their package or the project', () => {
    expect(shortenModuleId('/@fs/project/node_modules/.pnpm/vue@3/node_modules/vue/index.mjs?v=1', '/project')).toBe('vue/index.mjs')
    expect(shortenModuleId('/project/app/app.vue', '/project/')).toBe('app/app.vue')
    expect(shortenModuleId('virtual:nuxt:app.config', '/project')).toBe('virtual:nuxt:app.config')
    expect(shortenModuleId('/pages/index.vue?macro=true', '/project')).toBe('pages/index.vue')
    expect(shortenModuleId('/@fs/elsewhere/lib.mjs', '/project')).toBe('/elsewhere/lib.mjs')
    expect(shortenModuleId('@id/__x00__nuxt-nitro-virtual:#internal/nuxt/error-channel', '/project')).toBe('nuxt-nitro-virtual:#internal/nuxt/error-channel')
  })
})
