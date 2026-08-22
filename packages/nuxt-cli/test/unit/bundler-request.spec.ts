import { describe, expect, it } from 'vitest'

import { isBundlerRequest } from '../../src/dev/utils'

describe('isBundlerRequest', () => {
  it.each([
    '/@id/virtual:nuxt:.nuxt%2Fpaths.mjs',
    '/@vite/client',
    '/@fs/Users/someone/project/node_modules/vue/dist/vue.js',
    '/pages/ws.vue?vue&type=style&index=0&lang.css',
    '/node_modules/.vite/deps/vue.js',
    '/Users/someone/project/node_modules/.pnpm/nuxt@4.5.2/node_modules/nuxt/dist/app/entry.js',
    '/_nuxt/builds/meta/dev.json',
    '/app.vue?import',
  ])('classifies %s as bundler traffic', (url) => {
    expect(isBundlerRequest(url)).toBe(true)
  })

  it.each(['/', '/api/hello', '/ws', '/products?import-batch=3'])('leaves %s to the app', (url) => {
    expect(isBundlerRequest(url)).toBe(false)
  })

  it('treats script and style subresources as bundler-served in dev', () => {
    expect(isBundlerRequest('/pages/index.vue', 'script')).toBe(true)
    expect(isBundlerRequest('/some.css', 'style')).toBe(true)
    expect(isBundlerRequest('/', 'document')).toBe(false)
    expect(isBundlerRequest('/api/hello', 'empty')).toBe(false)
  })
})
