import { describe, expect, it } from 'vitest'
import { getRegistryFromContent } from '../../../../src/commands/module/_utils'

describe('getRegistryFromContent', () => {
  it('extracts scoped registry when scope is provided', () => {
    const content = `
registry=https://registry.npmjs.org/
@myorg:registry=https://my-registry.org/
@another:registry=https://another-registry.org/
    `

    expect(getRegistryFromContent(content, '@myorg')).toBe('https://my-registry.org/')
    expect(getRegistryFromContent(content, '@another')).toBe('https://another-registry.org/')
  })

  it('extracts default registry when scope is not provided', () => {
    const content = `
registry=https://registry.npmjs.org/
@myorg:registry=https://my-registry.org/
    `

    expect(getRegistryFromContent(content, null)).toBe('https://registry.npmjs.org/')
  })

  it('extracts default registry when scope is provided but not found', () => {
    const content = `
registry=https://registry.npmjs.org/
@myorg:registry=https://my-registry.org/
    `

    expect(getRegistryFromContent(content, '@notfound')).toBe('https://registry.npmjs.org/')
  })

  it('returns null when no registry is found', () => {
    const content = `
# some npmrc content without registry
some-other-setting=value
    `

    expect(getRegistryFromContent(content, null)).toBeNull()
    expect(getRegistryFromContent(content, '@myorg')).toBeNull()
  })

  it('handles empty content', () => {
    expect(getRegistryFromContent('', null)).toBeNull()
    expect(getRegistryFromContent('', '@myorg')).toBeNull()
  })
})
