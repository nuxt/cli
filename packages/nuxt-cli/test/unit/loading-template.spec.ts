import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveDefaultLoadingTemplate } from '../../src/dev/loading-template'

describe('resolveDefaultLoadingTemplate', () => {
  it('should reach `@nuxt/schema` through the project\'s own nuxt', async () => {
    const cwd = fileURLToPath(new URL('../../../../playground', import.meta.url))
    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({ loading: 'Starting Nuxt...' })).toContain('nuxt-loader-bar')
  })
})
