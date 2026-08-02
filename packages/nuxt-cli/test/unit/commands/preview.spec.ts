import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { runCommand } from 'citty'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import preview from '../../../src/commands/preview'

const { loadKit, loadNuxt, x } = vi.hoisted(() => ({
  loadKit: vi.fn(),
  loadNuxt: vi.fn(),
  x: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({ loadKit }))
vi.mock('tinyexec', () => ({ x }))

let cwd: string

async function writeNitroJSON(outputDir: string, data: Record<string, unknown> = {}) {
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'nitro.json'), JSON.stringify({
    preset: 'node-server',
    commands: { preview: 'node   ./server/index.mjs' },
    ...data,
  }))
}

describe('preview', () => {
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-preview-test-'))
    loadKit.mockResolvedValue({ loadNuxt })
    loadNuxt.mockImplementation(async (options) => {
      const nuxt = {
        options: { srcDir: cwd },
        hook: vi.fn((name, callback) => {
          if (name === 'nitro:init') {
            callback({ options: { output: { dir: '.output' } } })
          }
        }),
        close: vi.fn(),
      }
      options.overrides.modules[0](undefined, nuxt)
      return nuxt
    })
    x.mockResolvedValue({ exitCode: 0 })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    await rm(cwd, { recursive: true, force: true })
  })

  it('runs the build preview command with normalized whitespace and listen options', async () => {
    const outputDir = join(cwd, '.output')
    await writeNitroJSON(outputDir)

    await runCommand(preview, {
      rawArgs: [cwd, '--port=4321', '--host=127.0.0.1'],
    })

    expect(x).toHaveBeenCalledWith('node', ['./server/index.mjs'], {
      throwOnError: true,
      nodeOptions: expect.objectContaining({
        cwd: outputDir,
        env: expect.objectContaining({
          NUXT_PORT: '4321',
          NITRO_PORT: '4321',
          NUXT_HOST: '127.0.0.1',
          NITRO_HOST: '127.0.0.1',
        }),
      }),
    })
  })

  it('uses the configured output directory', async () => {
    const outputDir = join(cwd, 'dist', 'server-output')
    await writeNitroJSON(outputDir)
    loadNuxt.mockImplementation(async (options) => {
      const nuxt = {
        options: { srcDir: join(cwd, 'src') },
        hook: vi.fn((name, callback) => {
          if (name === 'nitro:init') {
            callback({ options: { output: { dir: '../dist/server-output' } } })
          }
        }),
        close: vi.fn(),
      }
      options.overrides.modules[0](undefined, nuxt)
      return nuxt
    })

    await runCommand(preview, { rawArgs: [cwd] })

    expect(x).toHaveBeenCalledWith('node', ['./server/index.mjs'], expect.objectContaining({
      nodeOptions: expect.objectContaining({ cwd: outputDir }),
    }))
  })

  it('falls back to the conventional output when Nuxt cannot load', async () => {
    loadKit.mockRejectedValue(new Error('Nuxt is unavailable'))
    const outputDir = join(cwd, '.output')
    await writeNitroJSON(outputDir)

    await runCommand(preview, { rawArgs: [cwd] })

    expect(x).toHaveBeenCalledWith('node', ['./server/index.mjs'], expect.objectContaining({
      nodeOptions: expect.objectContaining({ cwd: outputDir }),
    }))
  })

  it('uses host and port environment variables', async () => {
    vi.stubEnv('NUXT_PORT', '4100')
    vi.stubEnv('NUXT_HOST', 'localhost')
    await writeNitroJSON(join(cwd, '.output'))

    await runCommand(preview, { rawArgs: [cwd] })

    expect(x).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
      nodeOptions: expect.objectContaining({
        env: expect.objectContaining({
          NUXT_PORT: '4100',
          NITRO_PORT: '4100',
          NUXT_HOST: 'localhost',
          NITRO_HOST: 'localhost',
        }),
      }),
    }))
  })
})
