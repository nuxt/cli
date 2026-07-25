import { describe, expect, it } from 'vitest'

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
