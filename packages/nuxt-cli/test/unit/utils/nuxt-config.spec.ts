import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('should read a typescript config', async () => {
    await writeFile(join(root, 'nuxt.config.ts'), 'export default { buildDir: ".ts-build" } as Record<string, string>')

    await expect(getNuxtConfig(root)).resolves.toMatchObject({ buildDir: '.ts-build' })
  })
})
