import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { detectNpmRegistry, getRegistryFromContent } from '../../../src/utils/registry'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

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

  it('extracts registry from line with comments', () => {
    const content = `
registry=https://registry.npmjs.org/ # with comment
@myorg:registry=https://my-registry.org/ # another comment
    `

    expect(getRegistryFromContent(content, null)).toBe('https://registry.npmjs.org/')
    expect(getRegistryFromContent(content, '@myorg')).toBe('https://my-registry.org/')
  })
})

describe('detectNpmRegistry', () => {
  it('reads registry and credentials from the project directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nuxt-registry-'))
    directories.push(directory)
    await writeFile(join(directory, '.npmrc'), [
      'registry=https://registry.example.com/',
      '//registry.example.com/:_authToken=secret',
    ].join('\n'))

    await expect(detectNpmRegistry(null, directory)).resolves.toEqual({
      registry: 'https://registry.example.com',
      authToken: 'secret',
    })
    expect(process.env.COREPACK_NPM_REGISTRY).toBeUndefined()
  })
})
