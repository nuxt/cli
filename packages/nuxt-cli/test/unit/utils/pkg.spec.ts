import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getPkgJSON } from '../../../src/utils/pkg'

/** This package's own directory, where its dependencies resolve from. */
const packageDir = fileURLToPath(new URL('../../../', import.meta.url))

describe('getPkgJSON', () => {
  it('should resolve a package through a dependency chain', () => {
    const pkg = getPkgJSON(packageDir, 'nitropack', { via: ['nuxt', '@nuxt/nitro-server'] })

    expect(pkg?.name).toBe('nitropack')
  })

  it('should fall back to direct resolution when the chain breaks', () => {
    const pkg = getPkgJSON(packageDir, 'nuxt', { via: ['not-a-real-package-xyz'] })

    expect(pkg?.name).toBe('nuxt')
  })

  it('should not fall back to direct resolution when strict', () => {
    expect(getPkgJSON(packageDir, 'nuxt', { via: ['not-a-real-package-xyz'], strict: true })).toBeNull()
  })

  it('should resolve from the project when strict without a chain', () => {
    expect(getPkgJSON(packageDir, 'nuxt', { strict: true })?.name).toBe('nuxt')
  })
})
