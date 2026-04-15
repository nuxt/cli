import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/versions', () => ({
  getPkgJSON: vi.fn(() => null),
  getPkgVersion: vi.fn(() => ''),
}))

const { getBuilder } = await import('../../../src/utils/banner')

describe('getBuilder', () => {
  // regression for banner crash under pnpm globalVirtualStore
  // where vite is unreachable from cwd — getPkgJSON returns null
  it('does not throw when vite package.json cannot be resolved', () => {
    expect(() => getBuilder('/any', 'vite')).not.toThrow()
    expect(getBuilder('/any', 'vite')).toMatchObject({ name: 'Vite', version: '' })
  })
})
