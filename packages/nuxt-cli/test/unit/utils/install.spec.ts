import { describe, expect, it } from 'vitest'

import { getIgnoredBuilds, nonInteractiveArgs, runInstall, takeUnreportedIgnoredBuilds } from '../../../src/utils/install'

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
    const output = 'Ignored build scripts: esbuild@0.28.1.'

    expect(takeUnreportedIgnoredBuilds(output)).toEqual(['esbuild@0.28.1'])
    expect(takeUnreportedIgnoredBuilds(output)).toEqual([])
  })
})

describe('runInstall', () => {
  it('should report a missing package manager instead of throwing', async () => {
    const result = await runInstall({
      cwd: process.cwd(),
      packageManager: { name: 'npm', command: 'nuxt-cli-nonexistent-package-manager' },
    })

    expect(result.success).toBe(false)
    expect(result.missingPackageManager).toBe(true)
    expect(result.error).toContain('nuxt-cli-nonexistent-package-manager')
  })
})
