import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { nuxtIcon } from '../../../src/utils/ascii'
import { paint, resolveBackground } from '../../../src/utils/terminal-theme'

// eslint-disable-next-line no-control-regex
const strip = (text: string) => text.replaceAll(/\u001B\[[0-9;]*m|\u001B\]8;[^\u0007]*\u0007/g, '')

describe('terminal background', () => {
  it('takes an explicit setting at its word', () => {
    expect(resolveBackground({ NUXT_TERM_THEME: 'light' })).toBe('light')
    expect(resolveBackground({ NUXT_TERM_THEME: 'DARK' })).toBe('dark')
    expect(resolveBackground({ NUXT_TERM_THEME: 'light', COLORFGBG: '15;0' })).toBe('light')
  })

  it('reads the background the terminal reports', () => {
    expect(resolveBackground({ COLORFGBG: '15;0' })).toBe('dark')
    expect(resolveBackground({ COLORFGBG: '0;15' })).toBe('light')
    expect(resolveBackground({ COLORFGBG: '0;default;15' })).toBe('light')
    expect(resolveBackground({ COLORFGBG: '15;default;0' })).toBe('dark')
  })

  it('admits to not knowing rather than assuming', () => {
    expect(resolveBackground({})).toBe('unknown')
    expect(resolveBackground({ COLORFGBG: '15;default' })).toBe('unknown')
    expect(resolveBackground({ NUXT_TERM_THEME: 'solarized' })).toBe('unknown')
  })
})

describe('exact colours', () => {
  const withTerminal = (depth: number, run: () => void) => {
    const keys = ['getColorDepth', 'hasColors', 'isTTY'] as const
    const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(process.stdout, key)] as const)
    Object.defineProperty(process.stdout, 'getColorDepth', { value: () => depth, configurable: true })
    Object.defineProperty(process.stdout, 'hasColors', { value: () => depth > 1, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: depth > 1, configurable: true })
    try {
      run()
    }
    finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) {
          Object.defineProperty(process.stdout, key, descriptor)
        }
        else {
          Reflect.deleteProperty(process.stdout, key)
        }
      }
    }
  }

  it('uses the exact colour only where the background is known', () => {
    withTerminal(24, () => {
      expect(paint('brand', 'Nuxt', 'dark')).toContain('\u001B[38;2;0;220;130m')
      expect(paint('brand', 'Nuxt', 'light')).toContain('\u001B[38;2;0;145;92m')
      expect(paint('brand', 'Nuxt', 'unknown')).not.toContain('38;2')
    })
  })

  it('darkens the warning amber on a light terminal, where yellow cannot be read', () => {
    withTerminal(24, () => {
      expect(paint('warning', '1 warning', 'dark')).toContain('\u001B[38;2;255;200;87m')
      expect(paint('warning', '1 warning', 'light')).toContain('\u001B[38;2;138;90;0m')
    })
  })

  it('takes the nearest colour a 256-colour terminal can hold', () => {
    withTerminal(8, () => {
      // The cube entries closest to `#00DC82`, `#00915C`, `#FFC857` and `#8A5A00`.
      expect(paint('brand', 'Nuxt', 'dark')).toContain('\u001B[38;5;42m')
      expect(paint('brand', 'Nuxt', 'light')).toContain('\u001B[38;5;29m')
      expect(paint('warning', '!', 'dark')).toContain('\u001B[38;5;221m')
      expect(paint('warning', '!', 'light')).toContain('\u001B[38;5;94m')
    })
  })

  it('leaves the palette to the terminal below 256 colours', () => {
    withTerminal(4, () => {
      expect(paint('brand', 'Nuxt', 'dark')).not.toContain('38;')
      expect(strip(paint('brand', 'Nuxt', 'dark'))).toBe('Nuxt')
    })
  })

  it('hands the colour back so nothing after it is tinted', () => {
    for (const depth of [24, 8]) {
      withTerminal(depth, () => {
        for (const background of ['dark', 'light', 'unknown'] as const) {
          for (const tone of ['brand', 'warning'] as const) {
            // eslint-disable-next-line no-control-regex
            expect(paint(tone, 'Nuxt', background)).toMatch(/\u001B\[(?:39|0)m$/)
          }
        }
      })
    }
  })

  it('emits no escapes at all when there is no colour', () => {
    withTerminal(1, () => {
      expect(paint('brand', 'Nuxt', 'dark')).toBe('Nuxt')
      expect(paint('warning', 'Nuxt', 'light')).toBe('Nuxt')
      expect(paint('brand', 'Nuxt', 'unknown')).toBe('Nuxt')
    })
  })

  it('paints the init mark without leaving the terminal green', () => {
    withTerminal(24, () => {
      const icon = nuxtIcon()
      expect(strip(icon).split('\n')).toHaveLength(8)
      for (const line of icon.split('\n')) {
        // eslint-disable-next-line no-control-regex
        expect(line).toMatch(/\u001B\[(?:39|0)m$/)
      }
    })
  })
})
