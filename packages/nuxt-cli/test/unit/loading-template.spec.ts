import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDefaultLoadingTemplate } from '../../src/dev/loading-template'

const tempDirs: string[] = []
let savedNodePath: string | undefined
let hasSavedNodePath = false

async function createFakeProject(files: Record<string, string>): Promise<string> {
  if (!hasSavedNodePath) {
    savedNodePath = process.env.NODE_PATH
    hasSavedNodePath = true
  }
  delete process.env.NODE_PATH

  const dir = await mkdtemp(join(tmpdir(), 'nuxi-loading-template-'))
  tempDirs.push(dir)

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const fullPath = join(dir, relativePath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content)
    }),
  )

  return dir
}

afterEach(async () => {
  if (hasSavedNodePath) {
    if (savedNodePath === undefined) {
      delete process.env.NODE_PATH
    }
    else {
      process.env.NODE_PATH = savedNodePath
    }
    hasSavedNodePath = false
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveDefaultLoadingTemplate', () => {
  it('should reach `@nuxt/schema` through the project\'s own nuxt', async () => {
    const cwd = fileURLToPath(new URL('../../../../playground', import.meta.url))
    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({ loading: 'Starting Nuxt...' })).toContain('nuxt-loader-bar')
  })

  it('should read `loadingTemplate` from `nuxt/config`', async () => {
    const cwd = await createFakeProject({
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt/dist/config.mjs': `export const loadingTemplate = ({ loading } = {}) => \`from-nuxt-config:\${loading}\`\n`,
      'node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/@nuxt/schema/dist/index.mjs': `export const NuxtConfigSchema = { devServer: { loadingTemplate: () => 'from-schema' } }\n`,
    })

    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({ loading: 'Starting Nuxt...' })).toBe('from-nuxt-config:Starting Nuxt...')
  })

  it('should prefer `nuxt/config` over `nuxt-nightly/config`', async () => {
    const cwd = await createFakeProject({
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt/dist/config.mjs': `export const loadingTemplate = () => 'from-nuxt'\n`,
      'node_modules/nuxt-nightly/package.json': JSON.stringify({
        name: 'nuxt-nightly',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt-nightly/dist/config.mjs': `export const loadingTemplate = () => 'from-nightly'\n`,
    })

    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({})).toBe('from-nuxt')
  })

  it('should read `loadingTemplate` from `nuxt-nightly/config` when `nuxt` is absent', async () => {
    const cwd = await createFakeProject({
      'node_modules/nuxt-nightly/package.json': JSON.stringify({
        name: 'nuxt-nightly',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt-nightly/dist/config.mjs': `export const loadingTemplate = ({ loading } = {}) => \`from-nightly:\${loading}\`\n`,
    })

    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({ loading: 'Booting...' })).toBe('from-nightly:Booting...')
  })

  it('should fall back to `NuxtConfigSchema` when `nuxt/config` does not export `loadingTemplate`', async () => {
    const cwd = await createFakeProject({
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
          './config': './config.js',
        },
      }),
      'node_modules/nuxt/dist/index.mjs': 'export {}\n',
      'node_modules/nuxt/config.js': 'export function defineNuxtConfig(c) { return c }\n',
      'node_modules/nuxt/node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/nuxt/node_modules/@nuxt/schema/dist/index.mjs': `export const NuxtConfigSchema = { devServer: { loadingTemplate: ({ loading } = {}) => \`from-schema:\${loading}\` } }\n`,
    })

    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({ loading: 'Starting Nuxt...' })).toBe('from-schema:Starting Nuxt...')
  })

  it('should reach `@nuxt/schema` through `nuxt-nightly` when `nuxt-nightly/config` does not export `loadingTemplate`', async () => {
    const cwd = await createFakeProject({
      'node_modules/nuxt-nightly/package.json': JSON.stringify({
        name: 'nuxt-nightly',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
          './config': './config.js',
        },
      }),
      'node_modules/nuxt-nightly/dist/index.mjs': 'export {}\n',
      'node_modules/nuxt-nightly/config.js': 'export function defineNuxtConfig(c) { return c }\n',
      'node_modules/nuxt-nightly/node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/nuxt-nightly/node_modules/@nuxt/schema/dist/index.mjs': `export const NuxtConfigSchema = { devServer: { loadingTemplate: ({ loading } = {}) => \`from-nightly-schema:\${loading}\` } }\n`,
    })

    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({ loading: 'Starting Nuxt...' })).toBe('from-nightly-schema:Starting Nuxt...')
  })

  it('should ignore a non-function `loadingTemplate` export and continue lookup', async () => {
    const schemaOnly = await createFakeProject({
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt/dist/config.mjs': `export const loadingTemplate = 'not-a-function'\n`,
      'node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/@nuxt/schema/dist/index.mjs': `export const NuxtConfigSchema = { devServer: { loadingTemplate: () => 'from-schema' } }\n`,
    })

    const schemaTemplate = await resolveDefaultLoadingTemplate(schemaOnly)
    expect(schemaTemplate).toBeTypeOf('function')
    expect(schemaTemplate!({})).toBe('from-schema')

    const withNightly = await createFakeProject({
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt/dist/config.mjs': `export const loadingTemplate = 'not-a-function'\n`,
      'node_modules/nuxt-nightly/package.json': JSON.stringify({
        name: 'nuxt-nightly',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt-nightly/dist/config.mjs': `export const loadingTemplate = () => 'from-nightly'\n`,
      'node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/@nuxt/schema/dist/index.mjs': `export const NuxtConfigSchema = { devServer: { loadingTemplate: () => 'from-schema' } }\n`,
    })

    const nightlyTemplate = await resolveDefaultLoadingTemplate(withNightly)
    expect(nightlyTemplate).toBeTypeOf('function')
    expect(nightlyTemplate!({})).toBe('from-nightly')
  })

  it.each(['nightly', 'schema'])('should recover from a throwing `nuxt/config` via %s', async (fallback) => {
    const files: Record<string, string> = {
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt/dist/config.mjs': `throw new Error('config import failed')\n`,
      'node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/@nuxt/schema/dist/index.mjs': `export const NuxtConfigSchema = { devServer: { loadingTemplate: () => 'schema' } }\n`,
    }
    if (fallback === 'nightly') {
      files['node_modules/nuxt-nightly/package.json'] = JSON.stringify({
        name: 'nuxt-nightly',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      })
      files['node_modules/nuxt-nightly/dist/config.mjs'] = `export const loadingTemplate = () => 'nightly'\n`
    }

    const cwd = await createFakeProject(files)
    const template = await resolveDefaultLoadingTemplate(cwd)

    expect(template).toBeTypeOf('function')
    expect(template!({})).toBe(fallback)
  })

  it('should return `undefined` when neither `nuxt/config` nor `@nuxt/schema` provides a template', async () => {
    const cwd = await createFakeProject({
      'node_modules/nuxt/package.json': JSON.stringify({
        name: 'nuxt',
        type: 'module',
        exports: {
          './config': './dist/config.mjs',
        },
      }),
      'node_modules/nuxt/dist/config.mjs': 'export function defineNuxtConfig(c) { return c }\n',
      'node_modules/@nuxt/schema/package.json': JSON.stringify({
        name: '@nuxt/schema',
        type: 'module',
        exports: {
          '.': './dist/index.mjs',
        },
      }),
      'node_modules/@nuxt/schema/dist/index.mjs': 'export {}\n',
    })

    await expect(resolveDefaultLoadingTemplate(cwd)).resolves.toBeUndefined()
  })
})
