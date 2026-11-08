import { describe, expect, it } from 'vitest'

import { stripAnsi } from '../../../src/utils/formatting'
import { formatRouteRules } from '../../../src/utils/route-rules'

describe('formatRouteRules', () => {
  it('lists the app\'s rules as Nitro resolves them, without the ones Nuxt adds itself', () => {
    // `nitro.options.routeRules` from a real `nuxt build`, after Nitro normalised
    // the config and Nuxt added its own entries.
    const routeRules = {
      '/__nuxt_error': { cache: false },
      '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      '/': { prerender: true },
      '/blog/**': { swr: 3600, cache: { swr: true, maxAge: 3600 } },
      '/products/**': { isr: 600 },
      '/products/shoe': { isr: 60 },
      '/products/shoe/_payload.json': { ssr: true, isr: 60 },
      '/admin/**': { ssr: false },
      '/api/**': {
        cors: true,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': '*',
          'access-control-allow-headers': '*',
          'access-control-max-age': '0',
          'x-api': '1',
        },
      },
      '/legacy/**': { redirect: { to: '/v2/**', statusCode: 301, _redirectStripBase: '/legacy' } },
      '/proxy/**': { proxy: { to: 'https://example.com/**', _proxyStripBase: '/proxy' } },
      '/no-cache': { cache: false },
      '/blog/:_2': { prerender: true },
      '/feed.xml': { robots: false, noScripts: true },
      '/old-docs': { redirect: { to: '/docs', statusCode: 307 }, prerender: false },
    }

    expect(stripAnsi(formatRouteRules(routeRules, { buildAssetsDir: '/_nuxt/', columns: 200 }))).toBe([
      'Route rules  12 routes',
      '',
      'Route           Rules',
      '/               prerender',
      '/admin/**       ssr: false',
      '/api/**         cors, headers: x-api',
      '/blog/*         prerender',
      '/blog/**        swr 3600s',
      '/feed.xml       robots: false, noScripts',
      '/legacy/**      redirect → /v2/** (301)',
      '/no-cache       cache: false',
      '/old-docs       redirect → /docs (307)',
      '/products/**    isr 600s',
      '/products/shoe  isr 60s',
      '/proxy/**       proxy → https://example.com/**',
    ].join('\n'))
  })

  it('reads the shapes Nitro 3 resolves rules to', () => {
    // `nitro.options.routeRules` from a real `nuxt build` on Nuxt 5 nightly with Nitro 3.
    const routeRules = {
      '/**': { ssr: true },
      '/__nuxt_error': { cache: false },
      '/blog/**': { cache: { swr: true, maxAge: 3600 } },
      '/api/**': { headers: { 'x-api': '1' }, cors: {} },
      '/old': { redirect: { to: '/new', status: 307 } },
      '/proxy/**': { proxy: { to: 'https://example.com/**', base: '/proxy' } },
      '/_nuxt//**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    }

    expect(stripAnsi(formatRouteRules(routeRules, { buildAssetsDir: '/_nuxt/', columns: 200 })).split('\n').slice(3)).toEqual([
      '/api/**    cors, headers: x-api',
      '/blog/**   swr 3600s',
      '/old       redirect → /new (307)',
      '/proxy/**  proxy → https://example.com/**',
    ])
  })

  it('groups routes by rule once there are more than 20, listing the routes that fit', () => {
    // Shapes from nuxt.com's real build: hundreds of docs redirects opted out of
    // prerendering, ISR with query options, and a module's long generated route.
    const routeRules = {
      '/_nuxt': { headers: { 'X-Robots-Tag': 'noindex' } },
      '/_og/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      '/modules': { isr: { expiration: 3600, allowQuery: ['q'], passQuery: true }, prerender: false },
      [`/${'a'.repeat(60)}/**`]: { proxy: { to: 'https://example.com/**' } },
      '/admin/**': { ssr: false },
      ...Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`/p-${String(index).padStart(2, '0')}`, { isr: 300 }])),
      ...Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`/docs/${index}`, { redirect: { to: `/docs/new-${index}`, statusCode: 307 }, prerender: false }])),
    }

    expect(stripAnsi(formatRouteRules(routeRules, {
      buildAssetsDir: '/_nuxt/',
      publicAssets: [{ baseURL: '/_og', maxAge: 31536000 }],
      columns: 64,
    }))).toBe([
      'Route rules  24 routes',
      '',
      'Rules                      Routes',
      'isr 300s                   /p-00, /p-01, /p-02, /p-03, +14 more',
      'redirect                   /docs/0, /docs/1, /docs/2',
      'prerender: false, isr 36…  /modules',
      `proxy → https://example.…  /${'a'.repeat(35)}…`,
      'ssr: false                 /admin/**',
    ].join('\n'))
  })

  it('counts the rules past the first 20 groups', () => {
    const routeRules = Object.fromEntries(Array.from({ length: 23 }, (_, index) => [`/page-${String(index).padStart(2, '0')}`, { isr: index + 1 }]))
    const lines = stripAnsi(formatRouteRules(routeRules)).split('\n')

    expect(lines).toHaveLength(24)
    expect(lines.at(-1)).toBe('+3 more rules on 3 routes')
  })

  it('prints nothing when only Nuxt\'s own rules are set', () => {
    expect(formatRouteRules({ '/__nuxt_error': { cache: false } })).toBe('')
    expect(formatRouteRules(undefined)).toBe('')
  })
})
