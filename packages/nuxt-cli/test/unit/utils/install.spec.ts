import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getIgnoredBuilds, isExecutableAvailable, nonInteractiveArgs, runDedupe, runInstall, takeUnreportedIgnoredBuilds } from '../../../src/utils/install'

async function createFakePackageManager(name = 'pnpm', script: string[] = ['#!/bin/sh', 'echo "all done"']) {
  const dir = await mkdtemp(join(tmpdir(), 'nuxt-install-test-'))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, name), script.join('\n'))
  await chmod(join(bin, name), 0o755)
  vi.stubEnv('PATH', bin)
  return { dir }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('nonInteractiveArgs', () => {
  it('should opt pnpm out of prompts and strict dep builds', () => {
    expect(nonInteractiveArgs({ name: 'pnpm', agent: 'pnpm' })).toEqual([
      '--config.confirm-modules-purge=false',
      '--config.strict-dep-builds=false',
    ])
  })

  it('should pass no extra arguments to other package managers', () => {
    expect(nonInteractiveArgs({ name: 'npm', agent: 'npm' })).toEqual([])
    expect(nonInteractiveArgs({ name: 'yarn', agent: 'yarn' })).toEqual([])
  })
})

describe('getIgnoredBuilds', () => {
  it('should parse packages from the pnpm error', () => {
    const output = [
      'dependencies:',
      '+ nuxt 4.5.0',
      '',
      'ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild@0.28.1, better-sqlite3@12.0.0.',
      'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
    ].join('\n')

    expect(getIgnoredBuilds(output)).toEqual(['esbuild@0.28.1', 'better-sqlite3@12.0.0'])
  })

  it('should parse packages from the boxed pnpm warning', () => {
    const output = [
      '╭ Warning ───────────────────────────────╮',
      '│                                        │',
      '│   Ignored build scripts: esbuild@0.28.1.   │',
      '│                                        │',
      '╰────────────────────────────────────────╯',
    ].join('\n')

    expect(getIgnoredBuilds(output)).toEqual(['esbuild@0.28.1'])
  })

  it('should ignore colour codes and padding in the pnpm warning', () => {
    const output = '\u001B[33m│\u001B[39m   Ignored build scripts: esbuild@0.28.1.   \u001B[33m│\u001B[39m'

    expect(getIgnoredBuilds(output)).toEqual(['esbuild@0.28.1'])
  })

  it('should return nothing when no builds were ignored', () => {
    expect(getIgnoredBuilds('added 42 packages in 3s')).toEqual([])
  })
})

describe('takeUnreportedIgnoredBuilds', () => {
  it('should report each package only once per process', () => {
    expect(takeUnreportedIgnoredBuilds(['esbuild@0.28.1'])).toEqual(['esbuild@0.28.1'])
    expect(takeUnreportedIgnoredBuilds(['esbuild@0.28.1'])).toEqual([])
  })
})

describe('isExecutableAvailable', () => {
  it('should find a command on the PATH', () => {
    expect(isExecutableAvailable(process.platform === 'win32' ? 'cmd' : 'sh')).toBe(true)
  })

  it('should not find a command that does not exist', () => {
    expect(isExecutableAvailable('nuxt-cli-nonexistent-package-manager')).toBe(false)
  })

  it('should resolve an explicit path', () => {
    expect(isExecutableAvailable(process.execPath)).toBe(true)
    expect(isExecutableAvailable(join(tmpdir(), 'nuxt-cli-nonexistent-binary'))).toBe(false)
  })
})

describe('runInstall', () => {
  it.skipIf(process.platform === 'win32')('should report ignored builds printed before the end of the output', async () => {
    const { dir } = await createFakePackageManager('pnpm', [
      '#!/bin/sh',
      'echo "Ignored build scripts: esbuild@0.28.1."',
      'i=0; while [ $i -lt 60 ]; do echo "line $i"; i=$((i+1)); done',
    ])

    const result = await runInstall({ cwd: dir, packageManager: { name: 'pnpm', agent: 'pnpm' } })

    expect(result.success).toBe(true)
    expect(result.output).not.toContain('Ignored build scripts')
    expect(result.ignoredBuilds).toEqual(['esbuild@0.28.1'])
  })

  it('should report a missing package manager instead of throwing when installing', async () => {
    vi.stubEnv('PATH', join(tmpdir(), 'nuxt-cli-nonexistent-bin'))
    const result = await runInstall({
      cwd: tmpdir(),
      packageManager: { name: 'npm', agent: 'npm' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('`npm` was not found')
    expect(result.command).toBe('npm i')
  })
})

describe.skipIf(process.platform === 'win32')('runInstall arguments', () => {
  it('should add dev dependencies with `-D`', async () => {
    const { dir } = await createFakePackageManager('npm')
    const result = await runInstall({ cwd: dir, packageManager: { name: 'npm', agent: 'npm' }, dependencies: ['a'], dev: true })
    expect(result.command).toBe('npm i -D a')
  })

  it('should add to the root of a pnpm workspace', async () => {
    const { dir } = await createFakePackageManager('pnpm')
    await writeFile(join(dir, 'pnpm-workspace.yaml'), '')
    const result = await runInstall({ cwd: dir, packageManager: { name: 'pnpm', agent: 'pnpm' }, dependencies: ['a'] })
    expect(result.command).toMatch(/^pnpm add --workspace-root a /)
  })

  it('should prefix bare deno specifiers with `npm:`', async () => {
    const { dir } = await createFakePackageManager('deno')
    const result = await runInstall({ cwd: dir, packageManager: { name: 'deno', agent: 'deno' }, dependencies: ['a', 'jsr:@std/path'] })
    expect(result.command).toBe('deno add npm:a jsr:@std/path')
  })
})

describe('runDedupe', () => {
  it.skipIf(process.platform === 'win32')('should dedupe without printing the package manager output', async () => {
    const { dir } = await createFakePackageManager()

    const lines: string[] = []
    const result = await runDedupe({
      cwd: dir,
      packageManager: { name: 'pnpm', agent: 'pnpm' },
      onOutput: line => lines.push(line),
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe(`pnpm dedupe --config.confirm-modules-purge=false --config.strict-dep-builds=false`)
    expect(lines).toEqual(['all done'])
  })

  it.skipIf(process.platform === 'win32')('should dedupe with Yarn 1 by installing', async () => {
    const { dir } = await createFakePackageManager('yarn')
    const result = await runDedupe({ cwd: dir, packageManager: { name: 'yarn', agent: 'yarn' } })
    expect(result.command).toBe('yarn install')
  })

  it.skipIf(process.platform === 'win32')('should install after removing node_modules and the selected lockfile', async () => {
    const { dir } = await createFakePackageManager()
    const appDir = join(dir, 'app')
    const nodeModules = join(appDir, 'node_modules')
    const localLockFile = join(appDir, 'pnpm-lock.yaml')
    const workspaceLockFile = join(dir, 'pnpm-lock.yaml')
    await mkdir(nodeModules, { recursive: true })
    await writeFile(localLockFile, 'lockfileVersion: 9.0\n')
    await writeFile(workspaceLockFile, 'lockfileVersion: 9.0\n')

    const result = await runDedupe({
      cwd: appDir,
      packageManager: { name: 'pnpm', agent: 'pnpm' },
      recreateLockfile: true,
      lockFile: '../pnpm-lock.yaml',
    })

    expect(result.success).toBe(true)
    expect(result.command).toContain('pnpm i ')
    expect(existsSync(nodeModules)).toBe(false)
    expect(existsSync(workspaceLockFile)).toBe(false)
    expect(existsSync(localLockFile)).toBe(true)
  })

  it('should report unsupported dedupe commands as failures', async () => {
    const result = await runDedupe({
      cwd: process.cwd(),
      packageManager: { name: 'bun', agent: 'bun' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Deduplication is not supported for bun')
  })

  it('should report a missing package manager instead of throwing when deduping', async () => {
    vi.stubEnv('PATH', join(tmpdir(), 'nuxt-cli-nonexistent-bin'))
    const result = await runDedupe({
      cwd: tmpdir(),
      packageManager: { name: 'npm', agent: 'npm' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('`npm` was not found')
  })
})
