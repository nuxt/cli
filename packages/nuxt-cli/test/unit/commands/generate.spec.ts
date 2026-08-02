import { runCommand } from 'citty'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import generate from '../../../src/commands/generate'

const { loadNuxt, buildNuxt, writeTypes, clearBuildDir } = vi.hoisted(() => ({
  loadNuxt: vi.fn(),
  buildNuxt: vi.fn(),
  writeTypes: vi.fn(),
  clearBuildDir: vi.fn(),
}))

vi.mock('@clack/prompts', async importOriginal => ({
  ...await importOriginal<typeof import('@clack/prompts')>(),
  intro: vi.fn(),
  outro: vi.fn(),
}))
vi.mock('../../../src/utils/banner', () => ({ showBanner: vi.fn() }))
vi.mock('../../../src/utils/env', () => ({ overrideEnv: vi.fn() }))
vi.mock('../../../src/utils/fs', () => ({ clearBuildDir }))
vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({
    loadNuxt,
    buildNuxt,
    writeTypes,
    useNitro: () => ({
      options: {
        preset: 'static',
        output: {
          dir: '/project/dist',
          publicDir: '/project/dist',
        },
      },
    }),
  }),
}))
vi.mock('../../../src/utils/lockfile', () => ({
  acquireLock: () => ({ release: vi.fn() }),
  acquireOutputLock: () => ({ release: vi.fn() }),
  formatLockError: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  loadNuxt.mockResolvedValue({
    hook: vi.fn(),
    ready: vi.fn(),
    options: {
      buildDir: '/project/.nuxt',
      rootDir: '/project',
      ssr: true,
    },
  })
})

describe('generate', () => {
  it('enables Nuxt generation and Nitro static output', async () => {
    await runCommand(generate, { rawArgs: ['/project'] })

    expect(loadNuxt).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/project',
      overrides: expect.objectContaining({
        _generate: true,
        nitro: expect.objectContaining({ static: true }),
      }),
    }))
    expect(clearBuildDir).toHaveBeenCalledWith('/project/.nuxt')
    expect(writeTypes).toHaveBeenCalled()
    expect(buildNuxt).toHaveBeenCalled()
  })

  it('does not expose the build-only prerender option', () => {
    expect(generate.args).not.toHaveProperty('prerender')
  })
})
