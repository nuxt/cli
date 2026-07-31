import { describe, expect, it } from 'vitest'

import { stripCwd } from '../../src/dev/error'
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
