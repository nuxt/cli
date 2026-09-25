import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { CONFIG_EXTENSIONS, getNuxtConfig } from '../../../src/utils/nuxt-config'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nuxt-config-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('getNuxtConfig', () => {
  it('should list the extensions a config can have', () => {
    expect(CONFIG_EXTENSIONS).toContain('.ts')
    expect(CONFIG_EXTENSIONS).toContain('.mjs')
  })

  it('should return an empty object when there is no config', async () => {
    await expect(getNuxtConfig(root)).resolves.toEqual({})
  })

  it('should read a plain esm config', async () => {
    await writeFile(join(root, 'nuxt.config.mjs'), 'export default { buildDir: ".custom" }')

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.custom' })
  })

  it('should read a config using the global defineNuxtConfig', async () => {
    await writeFile(join(root, 'nuxt.config.mjs'), 'export default defineNuxtConfig({ buildDir: ".defined" })')

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.defined' })
  })

  it('should not leak defineNuxtConfig onto globalThis', async () => {
    await writeFile(join(root, 'nuxt.config.mjs'), 'export default { buildDir: ".custom" }')

    await getNuxtConfig(root)

    expect((globalThis as Record<string, unknown>).defineNuxtConfig).toBeUndefined()
  })

  it('should warn and return an empty config when the config throws', async () => {
    await writeFile(join(root, 'nuxt.config.mjs'), 'throw new Error("broken config")')
    const warn = vi.spyOn(consola, 'warn').mockImplementation(() => {})

    await expect(getNuxtConfig(root)).resolves.toEqual({})

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('broken config')
  })

  it('should read a config using a `~` alias through jiti', async () => {
    await writeFile(join(root, 'shared.ts'), 'export const buildDir = ".aliased"')
    await writeFile(join(root, 'nuxt.config.ts'), 'import { buildDir } from "~/shared"\n\nexport default { buildDir }')

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.aliased' })
  })

  it('should read a config using typescript syntax node cannot strip', async () => {
    await writeFile(join(root, 'nuxt.config.ts'), 'enum Dir { Build = ".enum-build" }\n\nexport default { buildDir: Dir.Build }')

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.enum-build' })
  })

  it('should not warn about a typeless package.json while reading the config', async () => {
    await writeFile(join(root, 'package.json'), '{"name":"my-project"}')
    await writeFile(join(root, 'nuxt.config.ts'), 'export default { buildDir: ".typeless" }')
    const original = process.emitWarning
    const warnings: unknown[] = []
    const recorder = (warning: string | Error, ...args: any[]) => {
      warnings.push(warning)
      return (original as any)(warning, ...args)
    }
    process.emitWarning = recorder
    onTestFinished(() => {
      process.emitWarning = original
    })

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.typeless' })

    expect(process.emitWarning, 'the recorder should be handed back').toBe(recorder)
    expect(warnings.filter(warning => String(warning).includes('MODULE_TYPELESS_PACKAGE_JSON'))).toEqual([])
  })

  it('should read a typescript config', async () => {
    await writeFile(join(root, 'nuxt.config.ts'), 'export default { buildDir: ".ts-build" } as Record<string, string>')

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.ts-build' })
  })
})
