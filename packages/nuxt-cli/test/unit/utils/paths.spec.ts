import { join } from 'node:path'
import process from 'node:process'

import { resolve } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'
import { relativeToProcess, resolveRootDir } from '../../../src/utils/paths'

describe('relativeToProcess', () => {
  it('should label paths relative to the working directory', () => {
    vi.stubEnv('FORCE_HYPERLINK', '0')
    expect(relativeToProcess(join(process.cwd(), 'src', 'app.vue'))).toBe(join('src', 'app.vue'))
    expect(relativeToProcess(process.cwd())).toBe(process.cwd())
  })
})

describe('resolveRootDir', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should default to the process working directory', () => {
    expect(resolveRootDir({ rootDir: '.' })).toBe(resolve(process.cwd()))
    expect(resolveRootDir({})).toBe(resolve(process.cwd()))
  })

  it.each(['rootDir', 'cwd'] as const)('should resolve %s', (key) => {
    expect(resolveRootDir({ [key]: 'apps/web' })).toBe(resolve('apps/web'))
  })

  it('should ignore a flag-like ROOTDIR', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    expect(resolveRootDir({ rootDir: '--watch' })).toBe(resolve('.'))
    expect(resolveRootDir({ cwd: 'apps/web', rootDir: '--watch' })).toBe(resolve('apps/web'))
    expect(warn).not.toHaveBeenCalled()
  })

  it('should let --cwd take precedence over ROOTDIR and warn on conflict', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    expect(resolveRootDir({ cwd: 'apps/docs', rootDir: 'apps/web' })).toBe(resolve('apps/docs'))
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('Both `--cwd` and `ROOTDIR`')
  })

  it.each([
    ['equivalent spellings', { cwd: 'apps/web', rootDir: 'apps/web/' }],
    ['a single directory', { cwd: 'apps/web' }],
  ])('should not warn for %s', (_label, args) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    expect(resolveRootDir(args)).toBe(resolve('apps/web'))
    expect(warn).not.toHaveBeenCalled()
  })
})
