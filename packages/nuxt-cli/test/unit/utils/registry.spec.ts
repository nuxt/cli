import { Buffer } from 'node:buffer'
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
      authorization: 'Bearer secret',
    })
    expect(process.env.COREPACK_NPM_REGISTRY).toBeUndefined()
  })
})

describe('auth token scoping', () => {
  async function npmrc(...lines: string[]): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'nuxt-registry-'))
    directories.push(directory)
    await writeFile(join(directory, '.npmrc'), lines.join('\n'))
    return directory
  }

  it('should not return a token registered for a different registry', async () => {
    const directory = await npmrc(
      'registry=https://registry.example.com/',
      '//registry.other.com/:_authToken=secret',
    )

    await expect(detectNpmRegistry(null, directory)).resolves.toMatchObject({ authToken: null })
  })

  it('should not return a token for a lookalike host', async () => {
    const directory = await npmrc(
      'registry=https://registry.example.com.evil.test/',
      '//registry.example.com/:_authToken=secret',
    )

    await expect(detectNpmRegistry(null, directory)).resolves.toMatchObject({
      registry: 'https://registry.example.com.evil.test',
      authToken: null,
    })
  })

  it('should resolve the token of the scoped registry that is actually used', async () => {
    const directory = await npmrc(
      'registry=https://registry.example.com/',
      '@scope:registry=https://scoped.example.com/',
      '//registry.example.com/:_authToken=default-token',
      '//scoped.example.com/:_authToken=scoped-token',
    )

    await expect(detectNpmRegistry('@scope', directory)).resolves.toEqual({
      registry: 'https://scoped.example.com',
      authToken: 'scoped-token',
      authorization: 'Bearer scoped-token',
    })
  })

  it('should resolve a token registered against the registry path, as npm does', async () => {
    const directory = await npmrc(
      'registry=https://proxy.example.com/npm/',
      '//proxy.example.com/npm/:_authToken=path-token',
    )

    await expect(detectNpmRegistry(null, directory)).resolves.toMatchObject({ authToken: 'path-token' })
  })

  it('should expand an environment reference in a token', async () => {
    const directory = await npmrc(
      'registry=https://registry.example.com/',
      // eslint-disable-next-line no-template-curly-in-string
      '//registry.example.com/:_authToken=${NUXT_TEST_NPM_TOKEN}',
    )
    process.env.NUXT_TEST_NPM_TOKEN = 'from-env'

    try {
      await expect(detectNpmRegistry(null, directory)).resolves.toMatchObject({ authToken: 'from-env' })
    }
    finally {
      delete process.env.NUXT_TEST_NPM_TOKEN
    }
  })

  it('should authorise with basic credentials when that is all there is', async () => {
    const directory = await npmrc(
      'registry=https://registry.example.com/',
      '//registry.example.com/:username=alice',
      `//registry.example.com/:_password=${Buffer.from('hunter2').toString('base64')}`,
    )

    await expect(detectNpmRegistry(null, directory)).resolves.toMatchObject({
      authToken: null,
      authorization: `Basic ${Buffer.from('alice:hunter2').toString('base64')}`,
    })
  })

  it('should prefer COREPACK_NPM_REGISTRY over the project npmrc', async () => {
    const directory = await npmrc('registry=https://registry.example.com/')
    process.env.COREPACK_NPM_REGISTRY = 'https://corepack.example.com/'

    try {
      await expect(detectNpmRegistry(null, directory)).resolves.toMatchObject({ registry: 'https://corepack.example.com' })
    }
    finally {
      delete process.env.COREPACK_NPM_REGISTRY
    }
  })
})
