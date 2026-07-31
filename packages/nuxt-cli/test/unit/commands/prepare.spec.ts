import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import prepare from '../../../src/commands/prepare'

const { loadNuxt, buildNuxt, writeTypes, clearBuildDir } = vi.hoisted(() => ({
  loadNuxt: vi.fn(),
  buildNuxt: vi.fn(),
  writeTypes: vi.fn(),
  clearBuildDir: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ loadNuxt, buildNuxt, writeTypes }),
}))

vi.mock('../../../src/utils/fs', () => ({ clearBuildDir }))

let cwd: string
let buildDir: string

async function writeLock(info: Record<string, unknown>) {
  await writeFile(join(buildDir, 'nuxt.lock'), JSON.stringify({
    pid: 424242,
    startedAt: Date.now(),
    command: 'dev',
    cwd,
    interactive: false,
    ...info,
  }))
}

describe('prepare', () => {
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-prepare-test-'))
    buildDir = await mkdtemp(join(tmpdir(), 'nuxt-prepare-build-'))
    loadNuxt.mockResolvedValue({ options: { buildDir } })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    await Promise.all([rm(cwd, { recursive: true, force: true }), rm(buildDir, { recursive: true, force: true })])
  })

  it('clears the build directory when nothing owns it', async () => {
    await runCommand(prepare, { rawArgs: [`--cwd=${cwd}`] })
    expect(clearBuildDir).toHaveBeenCalledWith(buildDir)
    expect(buildNuxt).toHaveBeenCalled()
  })

  it('clears the build directory when the lock is stale', async () => {
    await writeLock({ pid: 999999999 })
    await runCommand(prepare, { rawArgs: [`--cwd=${cwd}`] })
    expect(clearBuildDir).toHaveBeenCalled()
  })

  it('refreshes in place while a dev server is using the build directory', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
    await writeLock({ command: 'dev' })
    await runCommand(prepare, { rawArgs: [`--cwd=${cwd}`] })
    expect(clearBuildDir).not.toHaveBeenCalled()
    expect(buildNuxt).toHaveBeenCalled()
    expect(writeTypes).toHaveBeenCalled()
  })

  it('refreshes in place while a build is using the build directory', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
    await writeLock({ command: 'build' })
    await runCommand(prepare, { rawArgs: [`--cwd=${cwd}`] })
    expect(clearBuildDir).not.toHaveBeenCalled()
  })
})
