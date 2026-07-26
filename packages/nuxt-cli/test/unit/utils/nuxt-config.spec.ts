import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const loaderUrl = new URL('../../../src/utils/nuxt-config.ts', import.meta.url).href

/**
 * `getNuxtConfig` picks between Node's own loader and `jiti` by inspecting the
 * error codes Node raises, and Vitest resolves dynamic imports through Vite
 * rather than Node. Every case therefore runs in a real Node process, otherwise
 * the branch under test is never the one taken.
 */
async function loadConfig(files: Record<string, string>) {
  const cwd = await mkdtemp(join(tmpdir(), 'nuxi-nuxt-config-'))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(cwd, name), contents, 'utf8')
  }

  const script = `
    const { getNuxtConfig } = await import(${JSON.stringify(loaderUrl)})
    process.stdout.write(JSON.stringify(await getNuxtConfig(${JSON.stringify(cwd)})))
  `
  const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], { cwd })
  return { config: JSON.parse(stdout), stderr }
}

describe('getNuxtConfig', () => {
  it('should load a config with Node\'s own loader', async () => {
    const { config } = await loadConfig({
      'package.json': '{"name":"native","type":"module"}',
      'nuxt.config.ts': 'export default defineNuxtConfig({ modules: [\'@nuxt/image\'] })\n',
    })

    expect(config).toMatchObject({ modules: ['@nuxt/image'] })
  })

  it('should strip erasable types', async () => {
    const { config } = await loadConfig({
      'package.json': '{"name":"typed","type":"module"}',
      'nuxt.config.ts': 'const ssr: boolean = false\nexport default defineNuxtConfig({ ssr })\n',
    })

    expect(config).toMatchObject({ ssr: false })
  })

  it('should fall back to `jiti` for aliases Node cannot resolve', async () => {
    const { config } = await loadConfig({
      'package.json': '{"name":"aliased","type":"module"}',
      'module.ts': 'export const mod = \'@nuxt/content\'\n',
      'nuxt.config.ts': 'import { mod } from \'~/module\'\n\nexport default defineNuxtConfig({ modules: [mod] })\n',
    })

    expect(config).toMatchObject({ modules: ['@nuxt/content'] })
  })

  it('should fall back to `jiti` for TypeScript that cannot be stripped', async () => {
    const { config } = await loadConfig({
      'package.json': '{"name":"enums","type":"module"}',
      'nuxt.config.ts': 'enum Mod { Image = \'@nuxt/image\' }\n\nexport default defineNuxtConfig({ modules: [Mod.Image] })\n',
    })

    expect(config).toMatchObject({ modules: ['@nuxt/image'] })
  })

  it('should load a plain JavaScript config', async () => {
    const { config } = await loadConfig({
      'package.json': '{"name":"plain","type":"module"}',
      'nuxt.config.mjs': 'export default defineNuxtConfig({ ssr: false })\n',
    })

    expect(config).toMatchObject({ ssr: false })
  })

  it('should return an empty config when there is no config file', async () => {
    const { config } = await loadConfig({ 'package.json': '{"name":"bare","type":"module"}' })

    expect(config).toEqual({})
  })

  it('should return an empty config when the config throws', async () => {
    const { config } = await loadConfig({
      'package.json': '{"name":"broken","type":"module"}',
      'nuxt.config.ts': 'throw new Error(\'boom\')\n',
    })

    expect(config).toEqual({})
  })

  it('should not warn about module type for a config without `type: module`', async () => {
    const { config, stderr } = await loadConfig({
      'package.json': '{"name":"typeless"}',
      'nuxt.config.ts': 'export default defineNuxtConfig({ ssr: true })\n',
    })

    expect(config).toMatchObject({ ssr: true })
    expect(stderr).not.toContain('MODULE_TYPELESS_PACKAGE_JSON')
  })
})
