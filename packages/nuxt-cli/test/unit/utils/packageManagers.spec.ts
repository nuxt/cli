import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { getPackageManagerVersion } from '../../../src/utils/packageManagers'

describe('getPackageManagerVersion', () => {
  it('returns the command version', () => {
    expect(getPackageManagerVersion(process.execPath)).toBe(process.version)
  })

  it('does not fail when the package manager is unavailable', () => {
    expect(getPackageManagerVersion('nuxt-cli-missing-package-manager')).toBe('unknown')
  })
})
