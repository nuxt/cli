import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getNextSteps, useYarnNodeModulesLinker } from '../../src/init'

describe('useYarnNodeModulesLinker', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nuxt-init-yarn-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('should opt a fresh project out of plug\'n\'play', async () => {
    expect(await useYarnNodeModulesLinker(dir)).toBe(true)
    expect(await readFile(join(dir, '.yarnrc.yml'), 'utf8')).toContain('nodeLinker: node-modules')
  })

  it('should not overwrite yarn configuration from a template', async () => {
    await writeFile(join(dir, '.yarnrc.yml'), 'nodeLinker: pnp\n')
    expect(await useYarnNodeModulesLinker(dir)).toBe(false)
    expect(await readFile(join(dir, '.yarnrc.yml'), 'utf8')).toBe('nodeLinker: pnp\n')
  })

  it('should not add yarn 2+ configuration alongside a yarn 1 config', async () => {
    await writeFile(join(dir, '.yarnrc'), 'registry "https://example.com"\n')
    expect(await useYarnNodeModulesLinker(dir)).toBe(false)
    expect(existsSync(join(dir, '.yarnrc.yml'))).toBe(false)
  })
})

describe('getNextSteps', () => {
  const base = { shell: false, recoveryCommands: [] as string[], packageManager: 'npm' as const }

  it('should tell the user to change into the project directory', () => {
    expect(getNextSteps({ ...base, dir: 'my-app' })).toEqual(['cd my-app', 'npm run dev'])
  })

  it('should tell the user to change into a single-character directory', () => {
    expect(getNextSteps({ ...base, dir: 'a' })).toEqual(['cd a', 'npm run dev'])
  })

  it('should omit the change of directory when the project was created in place', () => {
    expect(getNextSteps({ ...base, dir: '.' })).toEqual(['npm run dev'])
  })

  it('should omit the change of directory when a shell is launched', () => {
    expect(getNextSteps({ ...base, dir: 'my-app', shell: true })).toEqual(['npm run dev'])
  })

  it('should include install when dependency installation was skipped', () => {
    expect(getNextSteps({
      ...base,
      dir: 'my-app',
      installSkipped: true,
    })).toEqual(['cd my-app', 'npm install', 'npm run dev'])
  })

  it('should ask for a retried install before recovery commands', () => {
    expect(getNextSteps({
      ...base,
      dir: 'my-app',
      installFailure: { error: new Error('offline') },
      recoveryCommands: ['pnpm approve-builds'],
      packageManager: 'pnpm',
    })).toEqual(['cd my-app', 'pnpm install', 'pnpm approve-builds', 'pnpm run dev'])
  })

  it('should use `task` for deno', () => {
    expect(getNextSteps({ ...base, dir: 'my-app', packageManager: 'deno' })).toEqual(['cd my-app', 'deno task dev'])
  })
})
