import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadProjectCli, supportsCommand } from '../src/launcher'

const cwd = process.cwd()
let nodePath: string | undefined

// `vitest` points `NODE_PATH` at the pnpm store, where a hoisted `@nuxt/cli` would be resolvable
beforeEach(() => {
  nodePath = process.env.NODE_PATH
  delete process.env.NODE_PATH
})

afterEach(() => {
  process.env.NODE_PATH = nodePath
  process.chdir(cwd)
})

const BACKSLASH_RE = /\\/g

function comparable(path: string | undefined) {
  return path?.replace(BACKSLASH_RE, '/')
}

function createProject(name: string, deps: Record<string, string>, options: { devEntry?: boolean } = {}) {
  const root = join(realpathSync(tmpdir()), `nuxi-launcher-${name}-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, private: true }))
  for (const [dep, version] of Object.entries(deps)) {
    const depRoot = join(root, 'node_modules', dep)
    mkdirSync(join(depRoot, 'dist', 'dev'), { recursive: true })
    writeFileSync(join(depRoot, 'package.json'), JSON.stringify({
      name: dep,
      version,
      type: 'module',
      exports: { '.': './dist/index.mjs' },
    }))
    writeFileSync(join(depRoot, 'dist', 'index.mjs'), 'export function runMain() {}')
    if (options.devEntry !== false) {
      writeFileSync(join(depRoot, 'dist', 'dev', 'index.mjs'), 'export const initialize = () => {}')
    }
  }
  return root
}

describe('loadProjectCli', () => {
  it('should resolve `@nuxt/cli` from the current directory', () => {
    const root = createProject('with-cli', { '@nuxt/cli': '3.40.0' })
    process.chdir(root)

    const cli = loadProjectCli([])
    expect(cli?.name).toBe('@nuxt/cli')
    expect(cli?.version).toBe('3.40.0')
    expect(comparable(cli?.devEntry)).toBe(comparable(join(root, 'node_modules', '@nuxt/cli', 'dist', 'dev', 'index.mjs')))
  })

  it('should resolve `@nuxt/cli` from an explicit `--cwd`', () => {
    const root = createProject('with-cwd', { '@nuxt/cli': '3.40.0' })

    expect(comparable(loadProjectCli(['dev', '--cwd', root])?.entry)).toContain(comparable(root))
    expect(comparable(loadProjectCli([`--cwd=${root}`, 'dev'])?.entry)).toContain(comparable(root))
  })

  it('should resolve `@nuxt/cli` from a positional root directory', () => {
    const root = createProject('with-positional', { '@nuxt/cli': '3.40.0' })

    expect(comparable(loadProjectCli(['info', root])?.entry)).toContain(comparable(root))

    process.chdir(createProject('without-cli', {}))
    expect(loadProjectCli(['init', root])).toBeNull()
  })

  it('should ignore a legacy `nuxi` dependency', () => {
    process.chdir(createProject('without-cli', {}))
    const root = createProject('with-legacy', { nuxi: '3.20.0' })

    expect(loadProjectCli(['dev', '--cwd', root])).toBeNull()
  })

  it('should ignore a project CLI that is too old to hand off to', () => {
    process.chdir(createProject('without-cli', {}))

    const nuxt2Cli = createProject('with-nuxt-2-cli', { '@nuxt/cli': '2.16.0' })
    expect(loadProjectCli(['dev', '--cwd', nuxt2Cli])).toBeNull()

    const preDevEntry = createProject('with-pre-dev-entry-cli', { '@nuxt/cli': '3.25.1' })
    expect(loadProjectCli(['dev', '--cwd', preDevEntry])).toBeNull()
  })

  it('should report a missing dev entry', () => {
    const root = createProject('without-dev-entry', { '@nuxt/cli': '3.40.0' }, { devEntry: false })

    expect(loadProjectCli(['dev', '--cwd', root])?.devEntry).toBeUndefined()
  })

  it('should never hand off to the launcher\'s own package', () => {
    const root = createProject('with-self', {})
    mkdirSync(join(root, 'node_modules', '@nuxt'), { recursive: true })
    symlinkSync(fileURLToPath(new URL('../', import.meta.url)), join(root, 'node_modules', '@nuxt', 'cli'), 'junction')
    process.chdir(root)

    expect(loadProjectCli(['dev'])).toBeNull()
  })

  it('should return `null` when there is no project CLI', () => {
    process.chdir(createProject('without-cli', {}))

    expect(loadProjectCli(['dev'])).toBeNull()
  })
})

describe('supportsCommand', () => {
  const main = { subCommands: { dev: () => {}, init: () => {} } }

  it('should defer commands the project CLI knows', () => {
    expect(supportsCommand(main, 'dev')).toBe(true)
  })

  it('should not defer `nuxi` commands the project CLI is missing', () => {
    expect(supportsCommand(main, 'add-template')).toBe(false)
  })

  it('should defer anything that is not a `nuxi` command', () => {
    expect(supportsCommand(main, 'complete')).toBe(true)
    expect(supportsCommand(main, 'frobnicate')).toBe(true)
  })

  it('should defer when the command list cannot be inspected', () => {
    expect(supportsCommand({ subCommands: () => ({}) }, 'dev')).toBe(true)
    expect(supportsCommand({}, 'dev')).toBe(true)
    expect(supportsCommand(undefined, 'dev')).toBe(true)
  })
})
