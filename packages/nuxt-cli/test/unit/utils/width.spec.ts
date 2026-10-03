import { describe, expect, it } from 'vitest'

import { stripAnsi, truncate, visibleWidth } from '../../../src/utils/width'

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
  it('should leave text that fits untouched', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('should cut by columns rather than characters', () => {
    expect(truncate('日本語テキスト', 7)).toBe('日本語…')
    expect(visibleWidth(truncate('日本語テキスト', 8))).toBeLessThanOrEqual(8)
  })

  it('should close styling and links it cuts through', () => {
    const cut = truncate(`\u001B[31mabcdef\u001B[39m \u001B]8;;https://nuxt.com\u0007a long label\u001B]8;;\u0007`, 10)
    expect(stripAnsi(cut)).toBe('abcdef a …')
    expect(cut.endsWith('\u001B]8;;\u0007\u001B[0m')).toBe(true)
  })
})
