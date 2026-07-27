import { sep } from 'node:path'

import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

import { formatRestartCause, formatRestartReason, mergeRestartReasons } from '../../src/dev/reason'

const rootDir = '/project'
const options = { rootDir, link: false } as const

describe('formatRestartCause', () => {
  it('should name a changed config file relative to the root directory', () => {
    expect(formatRestartCause({ type: 'config', files: [join(rootDir, 'nuxt.config.ts')] }, options))
      .toBe('nuxt.config.ts changed')
  })

  it('should name nested config files relative to the root directory', () => {
    expect(formatRestartCause({ type: 'config', files: [join(rootDir, '.config/nuxt.ts')] }, options))
      .toBe(`.config${sep}nuxt.ts changed`)
  })

  it('should list two files without truncating', () => {
    const files = [join(rootDir, 'nuxt.config.ts'), join(rootDir, '.nuxtrc')]
    expect(formatRestartCause({ type: 'config', files }, options))
      .toBe('nuxt.config.ts and .nuxtrc changed')
  })

  it('should truncate longer file lists with a count', () => {
    const files = ['nuxt.config.ts', '.nuxtrc', '.nuxtignore', '.env'].map(file => join(rootDir, file))
    expect(formatRestartCause({ type: 'config', files }, options))
      .toBe('nuxt.config.ts, .nuxtrc and 2 other files changed')
  })

  it('should use the singular form for a single remaining file', () => {
    const files = ['nuxt.config.ts', '.nuxtrc', '.nuxtignore'].map(file => join(rootDir, file))
    expect(formatRestartCause({ type: 'config', files }, options))
      .toBe('nuxt.config.ts, .nuxtrc and 1 other file changed')
  })

  it('should append changed config keys when known', () => {
    expect(formatRestartCause({ type: 'config', files: [join(rootDir, 'nuxt.config.ts')], keys: ['ssr', 'modules'] }, options))
      .toBe('nuxt.config.ts changed (ssr, modules)')
  })

  it('should describe non-file causes', () => {
    expect(formatRestartCause({ type: 'dist-removed' }, options)).toBe('Build output was removed')
    expect(formatRestartCause({ type: 'hook' }, options)).toBe('Nuxt requested a restart')
    expect(formatRestartCause({ type: 'shortcut' }, options)).toBe('Restart requested')
    expect(formatRestartCause({ type: 'error', message: 'Error: boom' }, options)).toBe('Unhandled error: Error: boom')
  })
})

describe('formatRestartReason', () => {
  it('should distinguish an in-place reload from a hard restart', () => {
    const reason = { type: 'shortcut' } as const
    expect(formatRestartReason(reason, options)).toBe('Restart requested. Reloading Nuxt...')
    expect(formatRestartReason(reason, { ...options, hard: true })).toBe('Restart requested. Restarting Nuxt in a new process...')
  })

  it('should fall back to the action alone when no reason is known', () => {
    expect(formatRestartReason(undefined, options)).toBe('Reloading Nuxt...')
  })
})

describe('mergeRestartReasons', () => {
  it('should combine config files and drop duplicates', () => {
    const merged = mergeRestartReasons(
      { type: 'config', files: ['/project/nuxt.config.ts'] },
      { type: 'config', files: ['/project/nuxt.config.ts', '/project/.nuxtrc'] },
    )
    expect(merged).toEqual({ type: 'config', files: ['/project/nuxt.config.ts', '/project/.nuxtrc'], keys: undefined })
  })

  it('should combine known config keys', () => {
    const merged = mergeRestartReasons(
      { type: 'config', files: ['/project/nuxt.config.ts'], keys: ['ssr'] },
      { type: 'config', files: ['/project/nuxt.config.ts'], keys: ['modules'] },
    )
    expect(merged).toMatchObject({ keys: ['ssr', 'modules'] })
  })

  it('should prefer the newer reason when the types differ', () => {
    expect(mergeRestartReasons({ type: 'config', files: ['/project/nuxt.config.ts'] }, { type: 'dist-removed' }))
      .toEqual({ type: 'dist-removed' })
    expect(mergeRestartReasons(undefined, { type: 'shortcut' })).toEqual({ type: 'shortcut' })
  })
})
