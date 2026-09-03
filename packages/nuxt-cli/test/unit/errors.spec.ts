import type { StackFrame } from 'youch-core/types'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applySourceMap, stripCwd } from '../../src/dev/error'
import { ActionableError, asActionableError, isRemotePeerError } from '../../src/utils/errors'

describe('actionableError', () => {
  it('should print its advice instead of a stack trace', () => {
    const error = new ActionableError('Run `pnpm install` first.')

    expect(error.stack).toBe('Run `pnpm install` first.')
    expect(error.message).toBe('Run `pnpm install` first.')
  })
})

describe('asActionableError', () => {
  it('should lead with the remedy a nuxt error carries instead of its frames', () => {
    const error = Object.assign(new Error('The module `@nuxt/image` could not be loaded. It may not be installed.'), {
      code: 'NUXT_B8017',
      fix: 'Run `npm install @nuxt/image` to install it.',
    })

    const actionable = asActionableError(error) as Error

    expect(actionable).toBeInstanceOf(ActionableError)
    expect(actionable.stack).toBe(actionable.message)
    expect(actionable.message).toBe('The module `@nuxt/image` could not be loaded. It may not be installed.\nRun `npm install @nuxt/image` to install it.')
    expect(actionable.stack).not.toContain('    at ')
  })

  it('should point at the docs a nuxt error references', () => {
    const error = Object.assign(new Error('Something is misconfigured.'), {
      fix: 'Set `compatibilityDate`.',
      docs: 'https://nuxt.com/docs',
    })

    expect((asActionableError(error) as Error).message).toBe('Something is misconfigured.\nSet `compatibilityDate`.\nSee https://nuxt.com/docs')
  })

  it('should leave an untagged error alone, since its stack is all there is', () => {
    const error = new Error('boom')

    const blank = Object.assign(new Error('boom'), { fix: '  ' })

    expect(asActionableError(error)).toBe(error)
    expect(asActionableError(blank)).toBe(blank)
    expect(asActionableError('not an error')).toBe('not an error')
  })
})

describe('isRemotePeerError', () => {
  it('should detect errors from the other end of a connection', () => {
    expect(isRemotePeerError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('aborted'), { code: 'ECONNABORTED' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }))).toBe(true)
  })

  it('should ignore other errors', () => {
    expect(isRemotePeerError(new Error('boom'))).toBe(false)
    expect(isRemotePeerError(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(false)
    expect(isRemotePeerError(undefined)).toBe(false)
  })
})

describe('stripCwd', () => {
  it('should strip posix working directories', () => {
    expect(stripCwd('at /home/me/app/pages/index.vue:3:1', '/home/me/app')).toBe('at ./pages/index.vue:3:1')
  })

  it('should strip both spellings of a windows working directory', () => {
    const cwd = 'C:\\Users\\me\\app'
    expect(stripCwd('at C:/Users/me/app/pages/index.vue:3:1', cwd)).toBe('at ./pages/index.vue:3:1')
    expect(stripCwd('at C:\\Users\\me\\app\\pages\\index.vue:3:1', cwd)).toBe('at .\\pages\\index.vue:3:1')
  })

  it('should leave unrelated paths alone', () => {
    expect(stripCwd('at /elsewhere/app/index.vue:1:1', '/home/me/app')).toBe('at /elsewhere/app/index.vue:1:1')
  })
})

describe('applySourceMap', () => {
  const mappings = 'AAAA,SAAS,IAAI;EACX,OAAO,CAAC;AACV'

  async function withMap(map: Record<string, unknown>, frame: Partial<StackFrame>) {
    const dir = await mkdtemp(join(tmpdir(), 'nuxi-sourcemap-'))
    const file = join(dir, 'out.mjs')
    await writeFile(file, 'export const noop = () => {}\n')
    await writeFile(`${file}.map`, JSON.stringify(map))
    const resolved = { fileName: file, ...frame } as StackFrame
    await applySourceMap(resolved)
    return resolved
  }

  it('should rewrite a frame to its original position', async () => {
    const frame = await withMap(
      { version: 3, sources: ['src/foo.ts'], names: [], mappings },
      { lineNumber: 2, columnNumber: 2 },
    )
    expect(frame.fileName?.endsWith('src/foo.ts')).toBe(true)
    expect(frame.lineNumber).toBe(2)
    expect(frame.columnNumber).toBe(2)
  })

  it('should resolve sources against `sourceRoot`', async () => {
    const frame = await withMap(
      { version: 3, sourceRoot: '../src', sources: ['foo.ts'], names: [], mappings },
      { lineNumber: 2, columnNumber: 2 },
    )
    expect(frame.fileName?.endsWith('src/foo.ts')).toBe(true)
  })

  it('should leave a frame with no mapping untouched', async () => {
    const frame = await withMap(
      { version: 3, sources: ['src/foo.ts'], names: [], mappings: '' },
      { lineNumber: 4, columnNumber: 0 },
    )
    expect(frame.lineNumber).toBe(4)
    expect(frame.fileName?.endsWith('out.mjs')).toBe(true)
  })
})
