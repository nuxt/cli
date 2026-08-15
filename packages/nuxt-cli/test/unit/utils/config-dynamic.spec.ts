import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { dirname, join } from 'pathe'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { addNuxtConfigEntries, readNuxtConfig } from '../../../src/utils/config'

const rolldownPath = dirname(fileURLToPath(import.meta.resolve('rolldown/package.json')))

const directories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function createProject(source: string, { parser }: { parser: boolean }): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-config-dynamic-')))
  directories.push(cwd)
  await writeFile(join(cwd, 'nuxt.config.ts'), source, 'utf8')
  if (parser) {
    await mkdir(join(cwd, 'node_modules'), { recursive: true })
    await symlink(rolldownPath, join(cwd, 'node_modules/rolldown'), 'dir')
  }
  else {
    vi.stubEnv('NUXT_CLI_PARSER', 'scanner')
  }
  return cwd
}

describe.each([
  ['scanner', { parser: false }],
  ['parser', { parser: true }],
])('%s', (name, options) => {
  const refusal = name === 'parser' ? 'Could not find a config object' : 'Default export is missing'
  async function add(source: string): Promise<{ error?: string, after: string }> {
    const cwd = await createProject(source, options)
    const config = await readNuxtConfig(cwd)
    let error: string | undefined
    try {
      await addNuxtConfigEntries(config!, { modules: ['@nuxt/image'] })
    }
    catch (err) {
      error = (err as Error).message
    }
    return { error, after: await readFile(join(cwd, 'nuxt.config.ts'), 'utf8') }
  }

  it('should refuse to add a key to a config that spreads another object', async () => {
    const source = 'export default defineNuxtConfig({ ...base })\n'

    const { error, after } = await add(source)

    expect(error).toContain('silently overridden')
    expect(after).toBe(source)
  })

  it('should never end up with two `modules` keys next to a spread', async () => {
    const { error, after } = await add('export default defineNuxtConfig({ ...base, modules: [\'a\'] })\n')

    expect(after.match(/modules:/g)).toHaveLength(1)
    if (error) {
      expect(error).toContain('silently overridden')
    }
    else {
      expect(after).toContain('modules: [\'a\', \'@nuxt/image\']')
    }
  })

  it('should refuse to add a key next to a computed one', async () => {
    const source = 'const key = \'modules\'\nexport default defineNuxtConfig({ [key]: [\'a\'] })\n'

    const { error, after } = await add(source)

    expect(error).toContain('silently overridden')
    expect(after).toBe(source)
  })

  it('should refuse a config whose default export is not an object', async () => {
    const cwd = await createProject('export default defineNuxtConfig(base)\n', options)

    await expect(readNuxtConfig(cwd)).rejects.toThrow(refusal)
  })

  it('should refuse a config chosen by a conditional', async () => {
    const cwd = await createProject('export default defineNuxtConfig(x ? { modules: [] } : { modules: [\'a\'] })\n', options)

    await expect(readNuxtConfig(cwd)).rejects.toThrow(refusal)
  })

  it('should refuse a config returned from a function', async () => {
    const cwd = await createProject('export default defineNuxtConfig(() => ({ modules: [] }))\n', options)

    await expect(readNuxtConfig(cwd)).rejects.toThrow(refusal)
  })

  it('should add a key to an ordinary config', async () => {
    const { error, after } = await add('export default defineNuxtConfig({ ssr: false })\n')

    expect(error).toBeUndefined()
    expect(after).toContain('@nuxt/image')
  })
})
