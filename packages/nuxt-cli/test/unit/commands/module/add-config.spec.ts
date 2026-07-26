import type { NuxtModule } from '../../../../src/commands/module/_utils'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import commands from '../../../../src/commands/module'
import * as utils from '../../../../src/commands/module/_utils'
import * as runCommands from '../../../../src/run-command'
import * as installUtils from '../../../../src/utils/install'
import * as versions from '../../../../src/utils/versions'

const { updateConfig } = vi.hoisted(() => ({
  updateConfig: vi.fn((_options: { onUpdate: (config: { modules?: unknown[], extends?: unknown[] }) => Promise<void> }) => Promise.resolve()),
}))

let manifest: Record<string, unknown> = {}

vi.mock('../../../../src/utils/config', () => ({ updateConfig }))
vi.mock('nypm', () => ({
  detectPackageManager: () => Promise.resolve({ name: 'npm', command: 'npm' }),
  packageManagers: [{ name: 'npm', command: 'npm' }],
}))
vi.mock('pkg-types', () => ({
  readPackageJSON: () => Promise.resolve({ devDependencies: { nuxt: '3.0.0' } }),
}))
vi.mock('../../../../src/utils/fetch', () => ({
  fetchJson: vi.fn(() => Promise.resolve({
    'dist-tags': { latest: '1.0.0' },
    'versions': { '1.0.0': manifest },
  })),
}))

function databaseEntry(name: string, npm: string): NuxtModule {
  return {
    name,
    npm,
    compatibility: { nuxt: '', requires: {}, versionMap: {} },
    description: '',
    repo: '',
    github: '',
    website: '',
    learn_more: '',
    category: '',
    type: 'community',
    maintainers: [],
    stats: { downloads: 0, stars: 0, maintainers: 0, contributors: 0, modules: 0 },
  }
}

interface CommandsType {
  subCommands: { add: () => Promise<{ setup: (args: any) => void }> }
}

async function addModule(name: string, pkg: Record<string, unknown>) {
  manifest = { devDependencies: { nuxt: '3.0.0' }, ...pkg }

  const addCommand = await (commands as CommandsType).subCommands.add()
  await addCommand.setup({ args: { cwd: '/fake-dir', _: [name] } })

  const config: { modules?: unknown[], extends?: unknown[] } = {}
  await updateConfig.mock.calls.at(-1)![0]!.onUpdate(config)
  return config
}

describe('module add config', () => {
  vi.spyOn(installUtils, 'runInstall').mockResolvedValue({ success: true, output: '', command: 'npm install', ignoredBuilds: [] })
  vi.spyOn(runCommands, 'runCommandDef').mockImplementation(vi.fn())
  vi.spyOn(versions, 'getNuxtVersion').mockResolvedValue('3.0.0')
  const fetchModules = vi.spyOn(utils, 'fetchModules').mockResolvedValue([])

  beforeEach(() => {
    updateConfig.mockClear()
  })

  it('should add a module to `modules`', async () => {
    const config = await addModule('nuxt-shiki', { main: './dist/module.mjs' })

    expect(config).toEqual({ modules: ['nuxt-shiki'] })
  })

  it('should keep an explicitly requested subpath', async () => {
    const config = await addModule('maz-ui/nuxt', { exports: { '.': './dist/index.mjs', './nuxt': './dist/nuxt.mjs' } })

    expect(config).toEqual({ modules: ['maz-ui/nuxt'] })
  })

  it('should keep an explicitly requested subpath when the database matches the package name', async () => {
    fetchModules.mockResolvedValueOnce([databaseEntry('sonner', 'vue-sonner')])

    const config = await addModule('vue-sonner/custom', { exports: { '.': './dist/index.mjs', './custom': './dist/custom.mjs' } })

    expect(config).toEqual({ modules: ['vue-sonner/custom'] })
  })

  it('should resolve a module exposed at a `nuxt` subpath', async () => {
    const config = await addModule('maz-ui', { exports: { '.': './dist/index.mjs', './nuxt': './dist/nuxt.mjs' } })

    expect(config).toEqual({ modules: ['maz-ui/nuxt'] })
  })

  it('should add a layer to `extends`', async () => {
    const config = await addModule('nuxt-seo-kit', { main: 'nuxt.config.ts' })

    expect(config).toEqual({ extends: ['nuxt-seo-kit'] })
  })

  it('should install the package without its subpath', async () => {
    manifest = { devDependencies: { nuxt: '3.0.0' }, exports: { '.': './dist/index.mjs', './nuxt': './dist/nuxt.mjs' } }

    const addCommand = await (commands as CommandsType).subCommands.add()
    await addCommand.setup({ args: { cwd: '/fake-dir', _: ['maz-ui/nuxt'] } })

    expect(installUtils.runInstall).toHaveBeenCalledWith(expect.objectContaining({
      dependencies: ['maz-ui@1.0.0'],
    }))
  })
})
