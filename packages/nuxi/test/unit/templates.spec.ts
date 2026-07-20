import type { NuxtOptions } from '@nuxt/schema'
import { describe, expect, it } from 'vitest'
import { applySuffix, templates } from '../../src/utils/templates/index'

describe('templates', () => {
  it('composables', () => {
    for (const name of ['useSomeComposable', 'someComposable', 'use-some-composable', 'use-someComposable', 'some-composable']) {
      expect(templates.composable!({ name, args: {}, nuxtOptions: { srcDir: '/src' } as NuxtOptions }).contents.trim().split('\n')[0]).toBe('export const useSomeComposable = () => {')
    }
  })
})

describe('templates registry — extensibility', () => {
  it('can be extended with new template types', () => {
    const key = '__test_new__'
    templates[key] = ({ name, nuxtOptions }) => ({
      path: `${nuxtOptions.srcDir}/custom/${name}.ts`,
      contents: `export const ${name} = 'extended'`,
    })
    const result = templates[key]!({ name: 'test', args: {}, nuxtOptions: { srcDir: '/src' } as NuxtOptions })
    expect(result.path).toBe('/src/custom/test.ts')
    expect(result.contents).toContain('extended')
    delete templates[key]
  })

  it('can override existing template types', () => {
    const original = templates.composable!
    templates.composable = ({ name }) => ({
      path: `/custom/${name}.ts`,
      contents: 'overridden',
    })
    expect(templates.composable!({ name: 'x', args: {}, nuxtOptions: { srcDir: '/' } as NuxtOptions }).contents).toBe('overridden')
    templates.composable = original
  })

  it('built-in templates are present and produce expected output', () => {
    const names = Object.keys(templates)
    expect(names).toContain('api')
    expect(names).toContain('app')
    expect(names).toContain('component')
    expect(names).toContain('page')
    expect(names).toContain('plugin')
  })
})

describe('applySuffix', () => {
  it('appends suffix for truthy args', () => {
    const result = applySuffix({ client: true, server: false }, ['client', 'server'])
    expect(result).toBe('.client')
  })

  it('appends multiple suffixes', () => {
    const result = applySuffix({ client: true, server: true }, ['client', 'server'])
    expect(result).toBe('.client.server')
  })

  it('appends mode-based suffix with unwrapFrom', () => {
    const result = applySuffix({ mode: 'server' }, ['client', 'server'], 'mode')
    expect(result).toBe('.server')
  })

  it('returns empty string when no args match', () => {
    const result = applySuffix({ other: true }, ['client', 'server'])
    expect(result).toBe('')
  })
})
