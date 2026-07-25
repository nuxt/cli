import { describe, expect, it } from 'vitest'

import { stripCwd } from '../../src/dev/error'
import { isBrokenPipe } from '../../src/utils/errors'

describe('isBrokenPipe', () => {
  it('should detect closed pipes', () => {
    expect(isBrokenPipe(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true)
    expect(isBrokenPipe(Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true)
  })

  it('should ignore other errors', () => {
    expect(isBrokenPipe(new Error('boom'))).toBe(false)
    expect(isBrokenPipe(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(false)
    expect(isBrokenPipe(undefined)).toBe(false)
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
