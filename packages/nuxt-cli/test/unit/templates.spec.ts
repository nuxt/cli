import type { NuxtOptions } from '@nuxt/schema'
import { resolve } from 'pathe'
import { describe, expect, it } from 'vitest'

import { escapesRoot } from '../../src/commands/add-template'
import { templates } from '../../src/utils/templates/index'

describe('templates', () => {
  it('composables', () => {
    for (const name of ['useSomeComposable', 'someComposable', 'use-some-composable', 'use-someComposable', 'some-composable']) {
      expect(templates.composable({ name, args: {}, nuxtOptions: { srcDir: '/src' } as NuxtOptions }).contents.trim().split('\n')[0]).toBe('export const useSomeComposable = () => {')
    }
  })
})

describe('escapesRoot', () => {
  it('should reject a name that traverses out of the project', () => {
    expect(escapesRoot('/project', resolve('/project/components', '../../etc/passwd.vue'))).toBe(true)
  })

  it('should reject an absolute name', () => {
    expect(escapesRoot('/project', resolve('/project/components', '/etc/passwd.vue'))).toBe(true)
  })

  it('should reject the project root itself', () => {
    expect(escapesRoot('/project', '/project')).toBe(true)
  })

  it('should allow a nested name', () => {
    expect(escapesRoot('/project', resolve('/project/components', 'nested/Thing.vue'))).toBe(false)
  })
})
