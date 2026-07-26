import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

import { updateConfig } from '../../../src/utils/config'

async function createProject(files: Record<string, string> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'nuxi-config-'))
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(cwd, name, '..'), { recursive: true })
    await writeFile(join(cwd, name), contents, 'utf8')
  }
  return cwd
}

describe('updateConfig', () => {
  it('should update a wrapped config in place, preserving comments', async () => {
    const cwd = await createProject({
      'nuxt.config.ts': [
        '// my config',
        'export default defineNuxtConfig({',
        '  modules: [\'@nuxt/image\'],',
        '})',
        '',
      ].join('\n'),
    })

    const result = await updateConfig({
      cwd,
      configFile: 'nuxt.config',
      onUpdate(config) {
        config.modules.push('@nuxt/content')
      },
    })

    expect(result.created).toBe(false)
    expect(result.configFile).toBe(join(cwd, 'nuxt.config.ts'))
    expect(await readFile(result.configFile, 'utf8')).toMatchInlineSnapshot(`
      "// my config
      export default defineNuxtConfig({
        modules: ['@nuxt/image', '@nuxt/content'],
      })"
    `)
  })

  it('should update a plain object export', async () => {
    const cwd = await createProject({ 'nuxt.config.mjs': 'export default { modules: [] }\n' })

    const { configFile } = await updateConfig({
      cwd,
      configFile: 'nuxt.config',
      onUpdate(config) {
        config.modules.push('@nuxt/content')
      },
    })

    expect(configFile).toBe(join(cwd, 'nuxt.config.mjs'))
    expect(await readFile(configFile, 'utf8')).toContain('@nuxt/content')
  })

  it('should resolve a config inside `.config`', async () => {
    const cwd = await createProject({ '.config/nuxt.ts': 'export default defineNuxtConfig({})\n' })

    const { configFile } = await updateConfig({
      cwd,
      configFile: 'nuxt.config',
      onUpdate(config) {
        config.ssr = false
      },
    })

    expect(configFile).toBe(join(cwd, '.config/nuxt.ts'))
    expect(await readFile(configFile, 'utf8')).toContain('ssr: false')
  })

  it('should create a missing config from `onCreate`', async () => {
    const cwd = await createProject()

    const { configFile, created } = await updateConfig({
      cwd,
      configFile: 'nuxt.config',
      onCreate: () => 'export default defineNuxtConfig({})\n',
      onUpdate(config) {
        config.modules = ['@nuxt/content']
      },
    })

    expect(created).toBe(true)
    expect(configFile).toBe(join(cwd, 'nuxt.config.ts'))
    expect(await readFile(configFile, 'utf8')).toContain('@nuxt/content')
  })

  it('should throw when `onCreate` aborts', async () => {
    const cwd = await createProject()

    await expect(updateConfig({ cwd, configFile: 'nuxt.config', onCreate: () => false }))
      .rejects
      .toThrow('Config file creation aborted.')
  })

  it('should throw for unsupported extensions', async () => {
    const cwd = await createProject({ 'nuxt.config.json': '{}' })

    await expect(updateConfig({ cwd, configFile: 'nuxt.config' }))
      .rejects
      .toThrow('Unsupported config file extension: .json')
  })

  it('should throw when there is no default export', async () => {
    const cwd = await createProject({ 'nuxt.config.ts': 'export const foo = 1\n' })

    await expect(updateConfig({ cwd, configFile: 'nuxt.config' }))
      .rejects
      .toThrow('Default export is missing in the config file!')
  })
})
