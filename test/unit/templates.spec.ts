import { describe, expect, it } from 'vitest'
import { composable } from '../../src/utils/templates'

describe('templates', () => {
  it('composables', () => {
    for (const name of ['useSomeComposable', 'someComposable', 'use-some-composable', 'use-someComposable', 'some-composable']) {
      expect(composable({ name, args: {} }).contents.trim().split('\n')[0]).toBe('export const useSomeComposable = () => {')
    }
  })
})
