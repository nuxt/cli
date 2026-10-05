import { describe, expect, it } from 'vitest'

import { formatDuration, truncate, visibleWidth } from '../../../src/utils/formatting'

describe('visibleWidth', () => {
  it('should ignore colour and hyperlink escapes', () => {
    expect(visibleWidth('\u001B[31mabc\u001B[39m')).toBe(3)
    expect(visibleWidth(`\u001B]8;;https://nuxt.com\u0007nuxt\u001B]8;;\u0007`)).toBe(4)
  })

  it('should count wide characters as two columns', () => {
    expect(visibleWidth('✨ ready')).toBe(8)
    expect(visibleWidth('🚀')).toBe(2)
    expect(visibleWidth('日本語')).toBe(6)
    expect(visibleWidth('ｆｕｌｌ')).toBe(8)
  })

  it('should count text-presentation symbols and braille as one column', () => {
    expect(visibleWidth('⚠ ✔ ℹ ✗')).toBe(7)
    expect(visibleWidth('⣠⣦⣠⡀ ━━ ·')).toBe(9)
  })

  it('should not count combining marks or variation selectors', () => {
    expect(visibleWidth('e\u0301')).toBe(1)
    expect(visibleWidth('⚠\uFE0F')).toBe(1)
  })
})

describe('truncate', () => {
  it('should cut by columns rather than characters', () => {
    expect(truncate('日本語テキスト', 7)).toBe('日本語…')
    expect(truncate('日本語テキスト', 8)).toBe('日本語…')
  })
})

describe('formatDuration', () => {
  it('should render milliseconds below a second', () => {
    expect(formatDuration(-1)).toBe('0.0ms')
    expect(formatDuration(0.42)).toBe('0.4ms')
    expect(formatDuration(12.4)).toBe('12ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('should render seconds with a fixed number of decimals', () => {
    expect(formatDuration(1000)).toBe('1.00s')
    expect(formatDuration(1234)).toBe('1.23s')
    expect(formatDuration(9999)).toBe('9.99s')
    expect(formatDuration(10_000)).toBe('10.0s')
    expect(formatDuration(59_999)).toBe('59.9s')
  })

  it('should render minutes and hours with padded seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s')
    expect(formatDuration(3_723_000)).toBe('1h 02m 03s')
  })
})
