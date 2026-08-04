import type { StackFrame } from 'youch-core/types'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applySourceMap, stripCwd } from '../../src/dev/error'
import { isRemotePeerError } from '../../src/utils/errors'

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
    expect(frame.fileName?.endsWith(join('src', 'foo.ts'))).toBe(true)
    expect(frame.lineNumber).toBe(2)
    expect(frame.columnNumber).toBe(2)
  })

  it('should resolve sources against `sourceRoot`', async () => {
    const frame = await withMap(
      { version: 3, sourceRoot: '../src', sources: ['foo.ts'], names: [], mappings },
      { lineNumber: 2, columnNumber: 2 },
    )
    expect(frame.fileName?.endsWith(join('src', 'foo.ts'))).toBe(true)
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
