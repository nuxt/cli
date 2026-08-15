import { stripVTControlCharacters } from 'node:util'

import { describe, expect, it } from 'vitest'

import { formatInfoBox } from '../../../src/utils/formatting'

function plain(box: string): string[] {
  return stripVTControlCharacters(box).split('\n').map(line => line.trimEnd())
}

describe('formatInfoBox', () => {
  it('should render one line per entry', () => {
    expect(plain(formatInfoBox({ Nuxt: '4.0.0', CLI: '4.0.0' }))).toEqual([
      expect.stringMatching(/^Nuxt +4\.0\.0$/),
      expect.stringMatching(/^CLI +4\.0\.0$/),
      '',
    ])
  })

  it('should render a placeholder for a missing value', () => {
    expect(plain(formatInfoBox({ Builder: undefined }))).toEqual([expect.stringMatching(/^Builder +-$/), ''])
  })

  it('should strip backticks from values', () => {
    expect(plain(formatInfoBox({ Modules: '`@nuxt/image`' }))).toEqual([expect.stringMatching(/^Modules +@nuxt\/image$/), ''])
  })

  it('should align values to the widest label', () => {
    const [first, second] = plain(formatInfoBox({ A: 'x', LongerLabel: 'y' }))

    expect(first!.indexOf('x')).toBe(second!.indexOf('y'))
  })

  it('should wrap a long value onto continuation lines', () => {
    const value = Array.from({ length: 40 }, (_, index) => `module-${index}`).join(' ')
    const lines = plain(formatInfoBox({ Modules: value })).filter(Boolean)

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.slice(1).every(line => line.startsWith('  '))).toBe(true)
  })
})
