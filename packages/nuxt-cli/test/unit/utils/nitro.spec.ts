import { describe, expect, it } from 'vitest'

import { findNitroPkgName } from '../../../src/utils/nitro'

describe('findNitroPkgName', () => {
  it('should read the declared nitro dependency', () => {
    expect(findNitroPkgName({ dependencies: { nitro: '^3.0.0' } })).toBe('nitro')
    expect(findNitroPkgName({ dependencies: { nitropack: '^2.13.0' } })).toBe('nitropack')
  })

  it('should read an aliased nightly dependency under its declared name', () => {
    expect(findNitroPkgName({ dependencies: { nitro: 'npm:nitro-nightly@latest' } })).toBe('nitro')
    expect(findNitroPkgName({ dependencies: { nitropack: 'npm:nitropack-nightly@2.0.0' } })).toBe('nitropack')
  })

  it('should prefer the current name when several are declared', () => {
    expect(findNitroPkgName({ dependencies: { nitro: '^3.0.0', nitropack: '^2.13.0' } })).toBe('nitro')
  })

  it('should read a dependency declared without a range', () => {
    expect(findNitroPkgName({ dependencies: { nitro: '' } })).toBe('nitro')
  })

  it('should return undefined for a manifest without a nitro dependency', () => {
    expect(findNitroPkgName({ dependencies: { vue: '^3.5.0' } })).toBeUndefined()
    expect(findNitroPkgName({ dependencies: { 'nitro-nightly': 'latest' } })).toBeUndefined()
    expect(findNitroPkgName({})).toBeUndefined()
    expect(findNitroPkgName(null)).toBeUndefined()
  })
})
