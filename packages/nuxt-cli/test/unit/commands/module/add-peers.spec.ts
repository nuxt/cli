import { describe, expect, it } from 'vitest'

import { resolveRequiredPeerDependencies } from '../../../../src/commands/module/add'

describe('resolveRequiredPeerDependencies', () => {
  it('should include required peers the project does not have', () => {
    const peers = resolveRequiredPeerDependencies([
      { pkg: '@pinia/nuxt@1.0.1', pkgName: '@pinia/nuxt', pkgVersion: '1.0.1', peerDependencies: { pinia: '^4.0.2' } },
    ], new Set(['nuxt', 'vue']))

    expect(peers).toEqual(['pinia@^4.0.2'])
  })

  it('should skip optional peers, existing dependencies and modules being added', () => {
    const peers = resolveRequiredPeerDependencies([
      {
        pkg: '@nuxt/example@1.0.0',
        pkgName: '@nuxt/example',
        pkgVersion: '1.0.0',
        peerDependencies: { 'vue': '^3.0.0', 'some-optional': '^1.0.0', '@pinia/nuxt': '^1.0.0' },
        optionalPeerDependencies: ['some-optional'],
      },
      { pkg: '@pinia/nuxt@1.0.1', pkgName: '@pinia/nuxt', pkgVersion: '1.0.1' },
    ], new Set(['nuxt', 'vue']))

    expect(peers).toEqual([])
  })

  it('should fall back to the bare name for ranges that are not valid specs', () => {
    const peers = resolveRequiredPeerDependencies([
      { pkg: 'mod@1.0.0', pkgName: 'mod', pkgVersion: '1.0.0', peerDependencies: { a: '*', b: '>=3 <5' } },
    ], new Set())

    expect(peers).toEqual(['a', 'b'])
  })
})
