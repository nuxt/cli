import { describe, expect, it } from 'vitest'

import { basePackageName, parseModuleSpec, resolveModuleEntry } from '../../../../src/commands/module/_utils'
import { describeModules } from '../../../../src/commands/module/add'
import { normalizeNuxtVersion } from '../../../../src/commands/module/search'

describe('parseModuleSpec', () => {
  it('should parse plain and scoped package names', () => {
    expect(parseModuleSpec('nuxt-shiki')).toEqual({ pkgName: 'nuxt-shiki', pkgVersion: undefined, subpath: undefined })
    expect(parseModuleSpec('@nuxt/content')).toEqual({ pkgName: '@nuxt/content', pkgVersion: undefined, subpath: undefined })
  })

  it('should parse versions', () => {
    expect(parseModuleSpec('@nuxt/content@2.9.0')).toEqual({ pkgName: '@nuxt/content', pkgVersion: '2.9.0', subpath: undefined })
    expect(parseModuleSpec('content@2')).toEqual({ pkgName: 'content', pkgVersion: '2', subpath: undefined })
  })

  it('should parse subpaths', () => {
    expect(parseModuleSpec('maz-ui/nuxt')).toEqual({ pkgName: 'maz-ui', pkgVersion: undefined, subpath: 'nuxt' })
    expect(parseModuleSpec('@maz-ui/nuxt/module')).toEqual({ pkgName: '@maz-ui/nuxt', pkgVersion: undefined, subpath: 'module' })
  })

  it('should parse a subpath with a version in either position', () => {
    expect(parseModuleSpec('maz-ui/nuxt@3.1.0')).toEqual({ pkgName: 'maz-ui', pkgVersion: '3.1.0', subpath: 'nuxt' })
    expect(parseModuleSpec('maz-ui@3.1.0/nuxt')).toEqual({ pkgName: 'maz-ui', pkgVersion: '3.1.0', subpath: 'nuxt' })
  })

  it('should reject invalid specs', () => {
    expect(parseModuleSpec('Not Valid')).toBeUndefined()
    expect(parseModuleSpec('@scope')).toBeUndefined()
    expect(parseModuleSpec('pkg@')).toBeUndefined()
    expect(parseModuleSpec('pkg//nuxt')).toBeUndefined()
    expect(parseModuleSpec('.pkg')).toBeUndefined()
  })
})

describe('basePackageName', () => {
  it('should strip subpaths', () => {
    expect(basePackageName('maz-ui/nuxt')).toBe('maz-ui')
    expect(basePackageName('@maz-ui/nuxt')).toBe('@maz-ui/nuxt')
    expect(basePackageName('@maz-ui/nuxt/module')).toBe('@maz-ui/nuxt')
  })
})

describe('resolveModuleEntry', () => {
  it('should leave regular modules alone', () => {
    expect(resolveModuleEntry({
      main: './dist/module.mjs',
      exports: { '.': { types: './dist/types.d.mts', import: './dist/module.mjs' } },
    })).toEqual({ isLayer: false })
  })

  it('should prefer a `nuxt` subpath export, then `module`', () => {
    expect(resolveModuleEntry({
      exports: { '.': './dist/index.mjs', './nuxt': './dist/nuxt.mjs', './module': './dist/module.mjs' },
    })).toEqual({ subpath: 'nuxt', isLayer: false })

    expect(resolveModuleEntry({
      exports: { '.': './dist/index.mjs', './module': './dist/module.mjs' },
    })).toEqual({ subpath: 'module', isLayer: false })
  })

  it('should ignore wildcard exports', () => {
    expect(resolveModuleEntry({
      exports: { '.': './dist/index.mjs', './*': './*' },
    })).toEqual({ isLayer: false })
  })

  it('should detect layers from their entrypoint', () => {
    expect(resolveModuleEntry({ main: 'nuxt.config.ts', type: 'module' })).toEqual({ isLayer: true })
    expect(resolveModuleEntry({ exports: { '.': './nuxt.config.js' } })).toEqual({ isLayer: true })
  })

  it('should detect layers that only publish a `nuxt.config`', () => {
    expect(resolveModuleEntry({ files: ['nuxt.config.ts', 'components'] })).toEqual({ isLayer: true })
    expect(resolveModuleEntry({ files: ['index.js'] })).toEqual({ isLayer: false })
  })
})

describe('normalizeNuxtVersion', () => {
  it('should expand major and minor shorthands', () => {
    expect(normalizeNuxtVersion('3')).toBe('3.0.0')
    expect(normalizeNuxtVersion('3.12')).toBe('3.12.0')
    expect(normalizeNuxtVersion('4.0.1')).toBe('4.0.1')
  })
})

describe('describeModules', () => {
  it('should describe modules, layers and a mixture of both', () => {
    expect(describeModules([{}])).toBe('module')
    expect(describeModules([{}, {}])).toBe('modules')
    expect(describeModules([{ isLayer: true }])).toBe('layer')
    expect(describeModules([{ isLayer: true }, { isLayer: true }])).toBe('layers')
    expect(describeModules([{}, { isLayer: true }])).toBe('module and layer')
    expect(describeModules([{}, {}, { isLayer: true }, { isLayer: true }])).toBe('modules and layers')
  })
})
