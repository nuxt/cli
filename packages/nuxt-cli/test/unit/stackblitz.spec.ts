import { describe, expect, it } from 'vitest'

import { resolveStackblitzURL } from '../../src/dev/stackblitz'

describe('resolveStackblitzURL', () => {
  it('should return nothing outside stackblitz', () => {
    expect(resolveStackblitzURL({ PWD: '/home/projects/abc123' }, undefined)).toBeUndefined()
    expect(resolveStackblitzURL({ PWD: '/home/projects/abc123' }, 'codesandbox')).toBeUndefined()
  })

  it('should derive the editor url from the project directory', () => {
    expect(resolveStackblitzURL({ PWD: '/home/projects/abc123' }, 'stackblitz')).toBe('https://stackblitz.com/edit/abc123')
    expect(resolveStackblitzURL({ PWD: '/home/projects/abc123/playground' }, 'stackblitz')).toBe('https://stackblitz.com/edit/abc123')
  })

  it('should derive the codeflow url from the repository directory', () => {
    expect(resolveStackblitzURL({ PWD: '/home/nuxt/cli' }, 'stackblitz')).toBe('https://stackblitz.com/edit/~/github.com/nuxt/cli')
    expect(resolveStackblitzURL({ PWD: '/home/nuxt/cli/packages/nuxt-cli' }, 'stackblitz')).toBe('https://stackblitz.com/edit/~/github.com/nuxt/cli')
  })

  it('should return nothing for an unrecognised directory', () => {
    expect(resolveStackblitzURL({ PWD: '/home/daniel' }, 'stackblitz')).toBeUndefined()
    expect(resolveStackblitzURL({ PWD: '/workspace/app' }, 'stackblitz')).toBeUndefined()
    expect(resolveStackblitzURL({}, 'stackblitz')).toBeUndefined()
  })
})
