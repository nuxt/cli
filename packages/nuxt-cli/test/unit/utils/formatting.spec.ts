import { describe, expect, it } from 'vitest'

import { formatBytes, formatDuration, stripControlChars, truncate, visibleWidth, wrapText } from '../../../src/utils/formatting'

describe('stripControlChars', () => {
  it('should leave no escape sequence behind, nested or not', () => {
    expect(stripControlChars('\u001B\u001B[31m[31mRED')).not.toContain('\u001B')
    expect(stripControlChars('\u001B]52;c;aGk=\u0007boom\u009B2J')).toBe(']52;c;aGk=boom2J')
  })

  it('should drop bell, carriage return and backspace but keep tabs and newlines', () => {
    expect(stripControlChars('a\u0007b\rc\bd\te\nf\u007F')).toBe('abcd\te\nf')
  })
})

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

describe('formatBytes', () => {
  it('uses decimal units', () => {
    expect([
      formatBytes(999),
      formatBytes(1000),
      formatBytes(2_454_000),
    ]).toEqual(['999 B', '1.00 kB', '2.45 MB'])
  })
})

describe('wrapText', () => {
  it('should break at spaces and keep the line\'s indentation', () => {
    expect(wrapText('    at handler (server/api/checkout.ts:9:1)', 24)).toEqual([
      '    at handler',
      '    (server/api/checkout',
      '    .ts:9:1)',
    ])
  })

  it('should break continuation rows at spaces when the indentation is too deep to keep', () => {
    expect(wrapText('      aa bbbbb cccccc', 10)).toEqual(['      aa', 'bbbbb', 'cccccc'])
  })

  it('should reopen styling and links on the next row', () => {
    const link = '\u001B]8;;file:///a.ts\u0007'
    expect(wrapText(`\u001B[31m${link}one two\u001B]8;;\u0007\u001B[39m`, 4)).toEqual([
      `\u001B[31m${link}one\u001B]8;;\u0007\u001B[0m`,
      `\u001B[31m${link}two\u001B]8;;\u0007\u001B[39m`,
    ])
  })

  it('should reopen only the styling still active at the break', () => {
    expect(wrapText('\u001B[1m\u001B[31mone\u001B[39m two', 4)).toEqual([
      '\u001B[1m\u001B[31mone\u001B[39m\u001B[0m',
      '\u001B[1mtwo',
    ])
    expect(wrapText('\u001B[38;5;208;4mone two', 4)).toEqual([
      '\u001B[38;5;208;4mone\u001B[0m',
      '\u001B[38;5;208;4mtwo',
    ])
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
