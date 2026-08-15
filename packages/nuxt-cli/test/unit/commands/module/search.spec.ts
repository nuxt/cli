import process from 'node:process'

import { runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import search from '../../../../src/commands/module/search'

const { fetchModules } = vi.hoisted(() => ({ fetchModules: vi.fn() }))

vi.mock('../../../../src/commands/module/_utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/commands/module/_utils')>()
  return { ...original, fetchModules }
})

function moduleEntry(name: string) {
  return {
    name,
    npm: `nuxt-${name}`,
    repo: `nuxt-modules/${name}`,
    github: `https://github.com/nuxt-modules/${name}`,
    website: `https://${name}.nuxtjs.org`,
    description: `The ${name} module`,
    category: 'Devtools',
    tags: [name],
    compatibility: { nuxt: '^3.0.0 || ^4.0.0' },
    maintainers: [{ name: 'someone', github: 'someone' }],
    stats: { stars: 1234, downloads: 56_789 },
  }
}

let stdout: string

describe('module search', () => {
  beforeEach(() => {
    stdout = ''
    fetchModules.mockResolvedValue([moduleEntry('image'), moduleEntry('content')])
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints machine readable results with `--json`', async () => {
    await runCommand(search, { rawArgs: ['image', '--json', '--nuxtVersion', '4.0.0'] })

    expect(JSON.parse(stdout)).toEqual({
      query: 'image',
      nuxtVersion: '4.0.0',
      modules: [{
        name: 'image',
        package: 'nuxt-image',
        description: 'The image module',
        homepage: 'https://image.nuxtjs.org',
        repository: 'https://github.com/nuxt-modules/image',
        compatibility: '^3.0.0 || ^4.0.0',
        stars: 1234,
        monthlyDownloads: 56_789,
        install: 'npx nuxt add image',
      }],
    })
  })

  it('prints an empty module list with `--json` when nothing matches', async () => {
    await runCommand(search, { rawArgs: ['zzzzzz', '--json', '--nuxtVersion', '4.0.0'] })

    expect(JSON.parse(stdout)).toEqual({ query: 'zzzzzz', nuxtVersion: '4.0.0', modules: [] })
  })

  it('leaves the human output untouched without `--json`', async () => {
    await runCommand(search, { rawArgs: ['image', '--nuxtVersion', '4.0.0'] })

    expect(stdout).toContain('image')
    expect(() => JSON.parse(stdout)).toThrow()
  })
})
