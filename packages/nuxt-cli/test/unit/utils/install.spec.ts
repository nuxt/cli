import { existsSync } from 'node:fs'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { getIgnoredBuilds, isExecutableAvailable, nonInteractiveArgs, runDedupe, runInstall, takeUnreportedIgnoredBuilds } from '../../../src/utils/install'

async function createFakePackageManager(script: string[] = ['#!/bin/sh', 'echo "all done"']) {
  const dir = await mkdtemp(join(tmpdir(), 'nuxt-install-test-'))
  const command = join(dir, 'fake-package-manager')
  await writeFile(command, script.join('\n'))
  await chmod(command, 0o755)
  return { dir, command }
}

describe('nonInteractiveArgs', () => {
  it('should opt pnpm out of prompts and strict dep builds', () => {
    expect(nonInteractiveArgs({ name: 'pnpm', command: 'pnpm' })).toEqual([
      '--config.confirm-modules-purge=false',
      '--config.strict-dep-builds=false',
    ])
  })

  it('should pass no extra arguments to other package managers', () => {
    expect(nonInteractiveArgs({ name: 'npm', command: 'npm' })).toEqual([])
    expect(nonInteractiveArgs({ name: 'yarn', command: 'yarn' })).toEqual([])
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
    const dir = await mkdtemp(join(tmpdir(), 'nuxt-install-test-'))
    const command = join(dir, 'fake-package-manager')
    await writeFile(command, [
      '#!/bin/sh',
      'echo "Ignored build scripts: esbuild@0.28.1."',
      'i=0; while [ $i -lt 60 ]; do echo "line $i"; i=$((i+1)); done',
    ].join('\n'))
    await chmod(command, 0o755)

    const result = await runInstall({ cwd: dir, packageManager: { name: 'pnpm', command } })

    expect(result.success).toBe(true)
    expect(result.output).not.toContain('Ignored build scripts')
    expect(result.ignoredBuilds).toEqual(['esbuild@0.28.1'])
  })

  it('should report a missing package manager instead of throwing', async () => {
    const result = await runInstall({
      cwd: process.cwd(),
      packageManager: { name: 'npm', command: 'nuxt-cli-nonexistent-package-manager' },
    })

    expect(result.success).toBe(false)
    expect(result.missingPackageManager).toBe(true)
    expect(result.error).toContain('nuxt-cli-nonexistent-package-manager')
    expect(result.command).toBe('nuxt-cli-nonexistent-package-manager install')
  })
})

describe('runDedupe', () => {
  it.skipIf(process.platform === 'win32')('should dedupe without printing the package manager output', async () => {
    const { dir, command } = await createFakePackageManager()

    const lines: string[] = []
    const result = await runDedupe({
      cwd: dir,
      packageManager: { name: 'pnpm', command },
      onOutput: line => lines.push(line),
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe(`${command} dedupe --config.confirm-modules-purge=false --config.strict-dep-builds=false`)
    expect(lines).toEqual(['all done'])
  })

  it.skipIf(process.platform === 'win32')('should install after removing the lockfile when recreating it', async () => {
    const { dir, command } = await createFakePackageManager()
    const lockFile = join(dir, 'pnpm-lock.yaml')
    await writeFile(lockFile, 'lockfileVersion: 9.0\n')

    const result = await runDedupe({
      cwd: dir,
      packageManager: { name: 'pnpm', command, lockFile: 'pnpm-lock.yaml' },
      recreateLockfile: true,
    })

    expect(result.success).toBe(true)
    expect(result.command).toContain(`${command} install`)
    expect(existsSync(lockFile)).toBe(false)
  })

  it('should report a missing package manager instead of throwing', async () => {
    const result = await runDedupe({
      cwd: process.cwd(),
      packageManager: { name: 'npm', command: 'nuxt-cli-nonexistent-package-manager' },
    })

    expect(result.success).toBe(false)
    expect(result.missingPackageManager).toBe(true)
  })
})
