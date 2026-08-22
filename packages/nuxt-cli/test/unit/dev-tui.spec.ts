import type { PanelState } from '../../src/dev/tui/panel'
import type { DevRequest } from '../../src/dev/tui/requests'
import type { DevRoute } from '../../src/dev/utils'

import process from 'node:process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { currentRequest, isServingRequest, runWithRequest } from '../../src/dev/serving-state'
import { DevEventLog } from '../../src/dev/tui/events'
import { HelpOverlay } from '../../src/dev/tui/help-overlay'
import { beginDevUI, setupDevUI } from '../../src/dev/tui/index'
import { InfoOverlay } from '../../src/dev/tui/info-overlay'
import { attachKeys } from '../../src/dev/tui/keys'
import { renderLogo } from '../../src/dev/tui/logo'
import { formatEvent, LogOverlay } from '../../src/dev/tui/overlay'
import { DEFAULT_HINTS, renderPanel, renderPanelText } from '../../src/dev/tui/panel'
import { RequestOverlay } from '../../src/dev/tui/request-overlay'
import { RequestLog } from '../../src/dev/tui/requests'
import { RouteOverlay } from '../../src/dev/tui/route-overlay'
import { resolveDevUISupport, supportsUnicode } from '../../src/dev/tui/support'
import { PanelSurface } from '../../src/dev/tui/surface'
import { truncate } from '../../src/dev/tui/width'
import { nuxtIcon } from '../../src/utils/ascii'
import { KEEPS_PROCESS_ALIVE } from '../../src/utils/errors'
import { terminalLink } from '../../src/utils/terminal-link'
import { paintBrand, resolveBackground } from '../../src/utils/terminal-theme'
import { releaseNotesUrl } from '../../src/utils/update-check'
import { render, screen } from '../utils/terminal'

const copied: string[] = []
vi.mock('tinyclip', () => ({
  writeText: (text: string) => {
    copied.push(text)
    return Promise.resolve()
  },
}))

// eslint-disable-next-line no-control-regex
const strip = (text: string) => text.replaceAll(/\u001B\[[0-9;]*m|\u001B\]8;[^\u0007]*\u0007/g, '')

const HINTS = [
  { key: 'r', label: 'restart', priority: 80 },
  { key: 'o', label: 'open', priority: 40 },
  { key: 'l', label: 'logs', priority: 70 },
  { key: 'h', label: 'help', priority: 100 },
  { key: 'q', label: 'quit', priority: 90 },
]

const READY = { status: 'ready', version: '4.5.2', readyMs: 1240, urls: [{ label: 'Local', url: 'http://localhost:3000/' }, { label: 'Network', url: 'http://192.168.1.4:3000/' }], hints: HINTS } satisfies PanelState

describe('dev tui panel', () => {
  it('leads with the wordmark, the urls and a status badge', () => {
    const lines = renderPanel({ ...READY }, 80, 30).map(strip)
    expect(lines.join('\n')).toMatchInlineSnapshot(`
      " ⣠⣦⣠⡀  Nuxt 4.5.2                                                ready in 1.24s 

         Local     http://localhost:3000/
         Network   http://192.168.1.4:3000/

         waiting for requests

        READY   watching for changes
       r restart · o open · l logs · h help · q quit"
    `)
  })

  it('counts warnings and errors without printing them', () => {
    const line = renderPanel({ ...READY, warnings: 2, errors: 1, requests: 12, medianMs: 8 }, 100, 30)
      .map(strip)
      .find(candidate => candidate.includes('request'))
    expect(line).toContain('12 requests')
    expect(line).toContain('8ms median')
    expect(line).toContain('2 warnings')
    expect(line).toContain('1 error')
  })

  it('shows an available update beside the version', () => {
    expect(strip(renderPanel({ ...READY, update: '4.6.0' }, 100, 30)[0]!)).toContain('Nuxt 4.5.2  → 4.6.0')
  })

  it('marks an error state without waiting to be asked', () => {
    const lines = renderPanel({ ...READY, status: 'error', errors: 1 }, 100, 30).map(strip)
    expect(lines.join('\n')).toContain('ERROR')
    expect(lines.join('\n')).toContain('an error was logged · press e to view it')
  })

  it('drops the least important hints first as the line narrows', () => {
    const line = strip(renderPanel({ status: 'ready', hints: HINTS }, 40, 30).at(-1)!)
    expect(line.length).toBeLessThanOrEqual(40)
    expect(line).not.toContain('o open')
    expect(line).toContain('h help')
    expect(line).toContain('q quit')
  })

  it('falls back to help alone when nothing else fits', () => {
    expect(strip(renderPanel({ status: 'ready', hints: HINTS }, 13, 30).at(-1)!)).toBe(' h help')
  })

  it('sheds blocks from the least important until it fits the terminal', () => {
    const tall = renderPanel({ ...READY }, 80, 30)
    const short = renderPanel({ ...READY }, 80, 6)
    expect(short.length).toBeLessThan(tall.length)
    expect(short.length).toBeLessThanOrEqual(5)
    expect(strip(short.join('\n'))).toContain('READY')
    expect(strip(short.join('\n'))).toContain('q quit')
  })

  it('keeps the status and the way out at the smallest size', () => {
    const lines = renderPanel({ ...READY }, 40, 3).map(strip)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('READY')
    expect(lines[1]).toContain('q quit')
  })

  it('never leaves a blank line at either edge', () => {
    for (const rows of [3, 4, 8, 12, 24, 60]) {
      const lines = renderPanel({ ...READY, warnings: 1 }, 80, rows)
      expect(lines[0]).not.toBe('')
      expect(lines.at(-1)).not.toBe('')
    }
  })

  it('shows passing feedback in place of the status description', () => {
    const lines = renderPanel({ ...READY, notice: { text: 'could not open a browser', tone: 'warn' } }, 100, 30).map(strip)
    const status = lines.find(line => line.includes('READY'))
    expect(status).toContain('could not open a browser')
    expect(status).not.toContain('watching for changes')
    // Feedback must never reflow the panel.
    expect(lines).toHaveLength(renderPanel({ ...READY }, 100, 30).length)
  })

  it('keeps a notice out of the way of a quit confirmation', () => {
    const text = renderPanelText({ ...READY, confirmQuit: true, notice: { text: 'copied', tone: 'success' } }, 100, 30)
    expect(text).not.toContain('copied')
  })

  it('keeps the status line and hints when the panel is squeezed', () => {
    const lines = renderPanel({ ...READY, notice: { text: 'copied', tone: 'success' } }, 60, 3).map(strip)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('READY')
    expect(lines[0]).toContain('copied')
    expect(lines[1]).toContain('q quit')
  })

  it('shows a progress bar with a running clock while loading', () => {
    const lines = renderPanel({ ...READY, status: 'starting', readyMs: undefined, progress: 0.5, elapsedMs: 3200, note: 'Bundling app' }, 100, 30).map(strip)
    const bar = lines.find(line => line.includes('%'))
    expect(bar).toContain('50%')
    expect(bar).toContain('3.2s')
    expect(bar).toContain('\u2501')
    // The bar borrows the summary line, so the panel keeps its shape.
    expect(lines).toHaveLength(renderPanel({ ...READY }, 100, 30).length)
  })

  it('lowercases sentence-shaped status notes without touching acronyms', () => {
    const status = (note: string) => strip(renderPanel({ ...READY, status: 'restarting', readyMs: undefined, note }, 100, 30).find(line => line.includes('RESTART'))!)
    expect(status('Restarting Nuxt...')).toContain('restarting Nuxt...')
    expect(status('HMR failed')).toContain('HMR failed')
  })

  it('holds the same layout through startup as when ready', () => {
    const starting = renderPanel({
      status: 'starting',
      version: '4.5.2',
      progress: 0.3,
      elapsedMs: 800,
      urls: [{ label: 'Local', url: 'http://localhost:3000/', pending: true }, { label: 'Network', url: 'http://192.168.1.4:3000/', pending: true }],
      hints: DEFAULT_HINTS,
      hintsDimmed: true,
    }, 100, 30)
    expect(starting).toHaveLength(renderPanel({ ...READY }, 100, 30).length)
  })

  it('greys the hint keys out until they work', () => {
    vi.stubEnv('FORCE_COLOR', '3')
    try {
      const dimmed = renderPanel({ ...READY, hints: DEFAULT_HINTS, hintsDimmed: true }, 100, 30).at(-1)!
      const live = renderPanel({ ...READY, hints: DEFAULT_HINTS }, 100, 30).at(-1)!
      expect(dimmed).not.toContain('\u001B[1mq\u001B[22m')
      expect(live).toContain('\u001B[1mq\u001B[22m')
    }
    finally {
      vi.unstubAllEnvs()
    }
  })

  it('spins on a bound URL until it is confirmed', () => {
    const pending = renderPanel({ ...READY, status: 'starting', readyMs: undefined, urls: [{ label: 'Local', url: 'http://localhost:3000/', pending: true }], frame: 0 }, 100, 30).map(strip)
    expect(pending.find(line => line.includes('localhost'))).toContain('\u280B')
    const confirmed = renderPanel({ ...READY }, 100, 30).map(strip)
    expect(confirmed.find(line => line.includes('localhost'))).not.toContain('\u280B')
  })

  it('replaces the hints with a confirmation prompt', () => {
    const text = renderPanelText({ ...READY, confirmQuit: true }, 100, 30)
    expect(text).toContain('QUIT?')
    expect(text).toContain('press y to confirm')
    expect(text).not.toContain('q quit')
  })

  it('substitutes plain characters when the terminal cannot render glyphs', () => {
    const text = renderPanelText({ ...READY, ascii: true, warnings: 1, errors: 2, requests: 3 }, 100, 30)
    expect(text).not.toMatch(/[⣠⣦⡀✔⚠✖]/)
    expect(text).toContain('! 1 warning')
    expect(text).toContain('x 2 errors')
  })

  it('never wraps a line past the terminal width', () => {
    for (const columns of [20, 40, 60, 80, 120]) {
      for (const line of renderPanel({ ...READY, warnings: 3, errors: 1, requests: 999, medianMs: 1234, update: '4.6.0', lastRequest: { method: 'GET', url: '/api/very/long/path/that/keeps/going', status: 500, duration: 42 } }, columns, 30)) {
        expect(strip(line).length).toBeLessThanOrEqual(columns)
      }
    }
  })
})

describe('dev tui traffic ticker', () => {
  const request = { method: 'GET', url: '/api/hello', status: 200, duration: 12 }
  const statusLine = (state: Parameters<typeof renderPanel>[0], columns: number) =>
    strip(renderPanel(state, columns, 30).find(line => strip(line).includes('READY'))!)

  it('never adds a line of its own', () => {
    expect(renderPanel({ ...READY }, 120, 30)).toHaveLength(
      renderPanel({ ...READY, lastRequest: request }, 120, 30).length,
    )
  })

  it('appends the last request to the status line', () => {
    expect(statusLine({ ...READY, lastRequest: request }, 120)).toContain('GET /api/hello · 200 · 12ms')
  })

  it('shows nothing until a request arrives', () => {
    expect(statusLine({ ...READY }, 120)).not.toContain('·')
  })

  it('is dropped rather than wrapping when the line is full', () => {
    const line = statusLine({ ...READY, lastRequest: request }, 44)
    expect(line.length).toBeLessThanOrEqual(44)
    expect(line).not.toContain('/api/hello')
  })

  it('truncates a long url to stay on the line', () => {
    const line = statusLine({ ...READY, lastRequest: { ...request, url: `/_nuxt/${'x'.repeat(300)}.js` } }, 100)
    expect(line.length).toBeLessThanOrEqual(100)
    expect(line).toContain('\u2026')
  })
})

describe('dev tui support', () => {
  const tty = { isTTY: true, columns: 120, rows: 40 }
  const base = { ci: false, test: false }

  it('runs on a terminal that can host it', () => {
    expect(resolveDevUISupport({ ...base, stdout: tty, stdin: { isTTY: true }, env: {} })).toEqual({ enabled: true })
  })

  it.each([
    ['a piped stdout', { stdout: { isTTY: false }, stdin: { isTTY: true }, env: {} }, 'no-output-tty'],
    ['a piped stdin', { stdout: tty, stdin: { isTTY: false }, env: {} }, 'no-input-tty'],
    ['a dumb terminal', { stdout: tty, stdin: { isTTY: true }, env: { TERM: 'dumb' } }, 'dumb-terminal'],
    ['a terminal too small to use', { stdout: { isTTY: true, columns: 30, rows: 40 }, stdin: { isTTY: true }, env: {} }, 'terminal-too-small'],
    ['too few rows to use', { stdout: { isTTY: true, columns: 120, rows: 6 }, stdin: { isTTY: true }, env: {} }, 'terminal-too-small'],
    ['an attached inspector', { stdout: tty, stdin: { isTTY: true }, env: {}, inspect: true }, 'inspector'],
    ['--no-tui', { stdout: tty, stdin: { isTTY: true }, env: {}, flag: false }, 'flag'],
    ['NUXT_TUI=0', { stdout: tty, stdin: { isTTY: true }, env: { NUXT_TUI: '0' } }, 'env'],
    ['NUXT_TUI=false', { stdout: tty, stdin: { isTTY: true }, env: { NUXT_TUI: 'FALSE' } }, 'env'],
  ])('falls back to plain logs for %s', (_name, options, reason) => {
    expect(resolveDevUISupport({ ...base, ...options })).toEqual({ enabled: false, reason })
  })

  it('lets NUXT_TUI=1 override the environment checks but not a pipe', () => {
    expect(resolveDevUISupport({ ...base, stdout: { isTTY: true, columns: 20, rows: 5 }, stdin: { isTTY: true }, env: { NUXT_TUI: '1' }, inspect: true })).toEqual({ enabled: true })
    expect(resolveDevUISupport({ ...base, stdout: { isTTY: false }, stdin: { isTTY: true }, env: { NUXT_TUI: '1' } })).toEqual({ enabled: false, reason: 'no-output-tty' })
  })

  it('takes an explicit single-byte locale at its word', () => {
    expect(supportsUnicode({ LANG: 'C' }, 'linux')).toBe(false)
    expect(supportsUnicode({ LC_ALL: 'POSIX' }, 'linux')).toBe(false)
    expect(supportsUnicode({ LANG: 'C.UTF-8' }, 'linux')).toBe(true)
    expect(supportsUnicode({ LANG: 'en_GB.UTF-8' }, 'linux')).toBe(true)
    expect(supportsUnicode({}, 'linux')).toBe(true)
  })

  it('trusts only a modern terminal host on windows', () => {
    expect(supportsUnicode({ LANG: 'en_GB.UTF-8' }, 'win32')).toBe(false)
    expect(supportsUnicode({ WT_SESSION: '1' }, 'win32')).toBe(true)
    expect(supportsUnicode({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(true)
  })
})

describe('dev tui logo', () => {
  const withTruecolor = (run: () => void) => {
    vi.stubEnv('NO_COLOR', '')
    const keys = ['getColorDepth', 'hasColors', 'isTTY'] as const
    const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(process.stdout, key)] as const)
    Object.defineProperty(process.stdout, 'getColorDepth', { value: () => 24, configurable: true })
    Object.defineProperty(process.stdout, 'hasColors', { value: () => true, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
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
      vi.unstubAllEnvs()
    }
  }

  // eslint-disable-next-line no-control-regex
  const rgbOf = (text: string) => [...text.matchAll(/\u001B\[38;2;(\d+);(\d+);(\d+)m/g)]
    .map(([, r, g, b]) => [Number(r), Number(g), Number(b)] as const)

  const luminance = ([r, g, b]: readonly [number, number, number]) => {
    const channel = (value: number) => {
      const ratio = value / 255
      return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const contrast = (colour: readonly [number, number, number], background: 'dark' | 'light') => {
    const other = background === 'dark' ? 0 : 1
    const [lighter, darker] = [luminance(colour), other].sort((a, b) => b - a) as [number, number]
    return (lighter + 0.05) / (darker + 0.05)
  }

  it('always draws the same four cells', () => {
    expect(strip(renderLogo())).toBe('\u28E0\u28E6\u28E0\u2840')
    for (const frame of [0, 1, 2, 3, 9]) {
      expect(strip(renderLogo({ working: true, frame }))).toBe('\u28E0\u28E6\u28E0\u2840')
    }
  })

  it.each(['dark', 'light', 'unknown'] as const)('travels a highlight across the cells while working on a %s terminal', (background) => {
    withTruecolor(() => {
      const frames = [0, 1, 2, 3].map(frame => renderLogo({ working: true, frame, background }))
      expect(new Set(frames).size).toBe(4)
      expect(new Set(frames.map(frame => strip(frame))).size).toBe(1)
    })
  })

  it.each(['dark', 'light', 'unknown'] as const)('lights the trailing cell with traffic colour on a %s terminal', (background) => {
    withTruecolor(() => {
      const idle = renderLogo({ background })
      const active = renderLogo({ active: true, background })
      expect(active).not.toBe(idle)
      expect(strip(active)).toBe(strip(idle))
    })
  })

  it('settles once ready', () => {
    expect(renderLogo({ frame: 3 })).toBe(renderLogo({ frame: 99 }))
  })

  it.each(['dark', 'light'] as const)('stays legible against a %s background', (background) => {
    withTruecolor(() => {
      const colours = [
        ...rgbOf(renderLogo({ background })),
        ...rgbOf(renderLogo({ background, active: true })),
      ]
      expect(colours.length).toBe(8)
      for (const colour of colours) {
        expect(contrast(colour, background)).toBeGreaterThanOrEqual(3)
      }
    })
  })

  it('leaves the colour to the terminal when the background is unknown', () => {
    withTruecolor(() => {
      expect(rgbOf(renderLogo({ background: 'unknown' }))).toHaveLength(0)
      expect(renderLogo({ background: 'unknown' })).toContain('\u001B[32m')
    })
  })

  it.each(['dark', 'light'] as const)('dims towards the %s background rather than always towards black', (background) => {
    withTruecolor(() => {
      const cells = rgbOf(renderLogo({ working: true, frame: 0, background }))
      const [lit, dimmed] = [cells[0]!, cells[1]!]
      expect(contrast(dimmed, background)).toBeLessThan(contrast(lit, background))
      const towards = background === 'light' ? 1 : 0
      expect(Math.abs(luminance(dimmed) - towards)).toBeLessThan(Math.abs(luminance(lit) - towards))
    })
  })

  it('draws nothing but the glyphs under NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1')
    try {
      for (const background of ['dark', 'light', 'unknown'] as const) {
        expect(renderLogo({ background, working: true, frame: 2 })).toBe('\u28E0\u28E6\u28E0\u2840')
      }
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})

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

describe('brand colour', () => {
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

  it('uses the exact green only where the background is known', () => {
    withTerminal(24, () => {
      expect(paintBrand('Nuxt', 'dark')).toContain('\u001B[38;2;0;220;130m')
      expect(paintBrand('Nuxt', 'light')).toContain('\u001B[38;2;0;145;92m')
      expect(paintBrand('Nuxt', 'unknown')).not.toContain('38;2')
    })
  })

  it('falls back to the terminal palette without truecolour', () => {
    withTerminal(4, () => {
      expect(paintBrand('Nuxt', 'dark')).not.toContain('38;2')
      expect(strip(paintBrand('Nuxt', 'dark'))).toBe('Nuxt')
    })
  })

  it('hands the colour back so nothing after it is tinted', () => {
    withTerminal(24, () => {
      for (const background of ['dark', 'light', 'unknown'] as const) {
        // eslint-disable-next-line no-control-regex
        expect(paintBrand('Nuxt', background)).toMatch(/\u001B\[(?:39|0)m$/)
      }
    })
  })

  it('emits no escapes at all when there is no colour', () => {
    withTerminal(1, () => {
      expect(paintBrand('Nuxt', 'dark')).toBe('Nuxt')
      expect(paintBrand('Nuxt', 'unknown')).toBe('Nuxt')
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

describe('dev event log', () => {
  const event = (overrides: Partial<Parameters<DevEventLog['push']>[0]>) => ({
    time: 0,
    level: 3,
    type: 'info',
    message: 'hello',
    source: 'cli' as const,
    ...overrides,
  })

  it('drops the oldest events past capacity', () => {
    const log = new DevEventLog(3)
    for (let i = 0; i < 5; i++) {
      log.push(event({ message: `m${i}` }))
    }
    expect(log.recent(10).map(e => e.message)).toEqual(['m2', 'm3', 'm4'])
  })

  it('notifies listeners of every event with its level', () => {
    const log = new DevEventLog()
    const seen: number[] = []
    log.onEvent(e => seen.push(e.level))
    log.push(event({ level: 0, message: 'boom' }))
    log.push(event({ message: 'after' }))
    expect(seen).toEqual([0, 3])
  })

  it('collapses repeated reports of the same error into one entry', () => {
    const log = new DevEventLog()
    const merges: boolean[] = []
    log.onEvent((_, merged) => merges.push(!!merged))
    const now = Date.now()
    log.push(event({ time: now, level: 0, type: 'error', message: 'Invalid end tag.', source: 'runtime', request: 'GET /', requestId: 7 }))
    log.push(event({ time: now, level: 0, type: 'error', message: 'Internal server error: Invalid end tag.\n Plugin: vite:vue\n File: /pages/index.vue', source: 'build' }))
    log.push(event({ time: now, level: 0, type: 'error', message: 'Invalid end tag.', source: 'runtime', request: 'GET /', requestId: 8 }))

    const errors = log.recent(10, e => e.level <= 0)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.repeats).toBe(3)
    // The wording with the file and the plugin is the one worth keeping.
    expect(errors[0]!.message).toContain('vite:vue')
    // The first attribution wins; the entry stays tied to its request.
    expect(errors[0]!.requestId).toBe(7)
    expect(merges).toEqual([false, true, true])
  })

  it('collapses the same problem wrapped differently by each tool', () => {
    const log = new DevEventLog()
    const now = Date.now()
    log.push(event({ time: now, level: 0, type: 'error', message: '[/pages/index.vue — Invalid end tag.\n at createCompilerError (compiler-core.cjs.js:1378:17)' }))
    log.push(event({ time: now, level: 0, type: 'error', message: 'Internal server error: Invalid end tag.\n Plugin: vite:vue\n File: /pages/index.vue:8:29' }))
    expect(log.recent(10, e => e.level <= 0)).toHaveLength(1)
  })

  it('treats backticks as formatting when comparing messages', () => {
    const log = new DevEventLog()
    const now = Date.now()
    log.push(event({ time: now, level: 1, type: 'warn', message: 'Failed to stringify dev server logs. Received DevalueError: Cannot stringify arbitrary non-POJOs.' }))
    log.push(event({ time: now, level: 1, type: 'warn', message: 'Failed to stringify dev server logs. Received `DevalueError: Cannot stringify arbitrary non-POJOs`.' }))
    expect(log.recent(10, e => e.level <= 1)).toHaveLength(1)
  })

  it('keeps distinct errors apart and leaves info logs alone', () => {
    const log = new DevEventLog()
    const now = Date.now()
    log.push(event({ time: now, level: 0, type: 'error', message: 'Invalid end tag.' }))
    log.push(event({ time: now, level: 0, type: 'error', message: 'Cannot resolve import ./missing.ts' }))
    log.push(event({ time: now, message: 'hmr update /app.vue' }))
    log.push(event({ time: now, message: 'hmr update /app.vue' }))
    expect(log.recent(10, e => e.level <= 0)).toHaveLength(2)
    expect(log.recent(10, e => e.level > 1)).toHaveLength(2)
  })

  it('empties the history on clear and tells listeners', () => {
    const log = new DevEventLog()
    let cleared = 0
    log.onClear(() => cleared++)
    log.push(event({ message: 'before' }))
    log.clear()
    expect(log.recent(10)).toEqual([])
    expect(cleared).toBe(1)
  })

  it('recovers severity from a badge a tool printed itself', () => {
    const log = new DevEventLog()
    log.push(event({ level: 2, type: 'log', message: 'WARN  [VUE_ROUTER_R0004] No match found' }))
    const [recovered] = log.recent(1)
    expect(recovered!.level).toBe(1)
    expect(recovered!.type).toBe('warn')
    expect(recovered!.message).toBe('[VUE_ROUTER_R0004] No match found')
  })

  it('recovers severity from a colour-wrapped badge without breaking styling', () => {
    const log = new DevEventLog()
    const message = '\u001B[43m\u001B[30m WARN \u001B[39m\u001B[49m [VUE_ROUTER_R0004] No match'
    log.push(event({ level: 2, type: 'log', message }))
    const [recovered] = log.recent(1)
    expect(recovered!.level).toBe(1)
    expect(recovered!.type).toBe('warn')
    expect(recovered!.message).toBe(message)
  })

  it('treats a printed error badge as an error', () => {
    const log = new DevEventLog()
    log.push(event({ level: 2, type: 'log', message: 'ERROR: something broke' }))
    expect(log.recent(1)[0]).toMatchObject({ level: 0, message: 'something broke' })
  })

  it('leaves events that already carry a severity alone', () => {
    const log = new DevEventLog()
    log.push(event({ level: 0, type: 'error', message: 'WARN looking text' }))
    expect(log.recent(1)[0]!.message).toBe('WARN looking text')
  })

  // A printed line reaches the reporter before the bytes that render it, so a
  // `print` here carries no `rendered` yet, which is when a filter would match
  // the same entry twice.
  const replay = (order: string[]) => {
    const events = new DevEventLog()
    for (const step of order) {
      if (step === 'report') {
        events.push({ time: Date.now(), level: 3, type: 'info', message: 'same line', source: 'runtime', request: 'GET /', requestId: 1 }, { absorb: true })
      }
      else {
        events.push({ time: Date.now(), level: 3, type: 'log', message: 'same line', raw: true, source: 'runtime' })
      }
    }
    return events.recent(10)
  }

  it.each([
    ['report then print, twice', ['report', 'print', 'report', 'print']],
    ['both reports first', ['report', 'report', 'print', 'print']],
    ['both prints first', ['print', 'print', 'report', 'report']],
    ['print then report, twice', ['print', 'report', 'print', 'report']],
  ])('keeps two identical logs from one request apart (%s)', (_name, order) => {
    expect(replay(order)).toHaveLength(2)
  })

  it('does not swallow a printed line that never got its own report', () => {
    expect(replay(['report', 'print', 'print'])).toHaveLength(2)
  })

  it('pairs a report with printed output rather than duplicating it', () => {
    const events = new DevEventLog()
    events.push({ time: Date.now(), level: 3, type: 'log', message: 'hello', rendered: '\u001B[36mhello\u001B[39m', raw: true, source: 'runtime' })
    events.push({ time: Date.now(), level: 3, type: 'info', message: 'hello', source: 'runtime', request: 'GET /', requestId: 4 }, { absorb: true })

    const [only] = events.recent(10)
    expect(events.recent(10)).toHaveLength(1)
    expect(only).toMatchObject({ request: 'GET /', requestId: 4, rendered: '\u001B[36mhello\u001B[39m' })
  })

  it('filters recent events', () => {
    const log = new DevEventLog()
    log.push(event({ source: 'runtime', message: 'srv' }))
    log.push(event({ message: 'cli' }))
    expect(log.recent(10, e => e.source === 'runtime').map(e => e.message)).toEqual(['srv'])
  })
})

describe('request attribution', () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  const queue: Array<() => void> = []

  it('has nothing to attribute a log to outside a request', () => {
    expect(currentRequest()).toBeUndefined()
    expect(isServingRequest()).toBe(false)
  })

  it('attributes work on the call stack to the request that started it', () => {
    runWithRequest('GET /about', (request) => {
      expect(isServingRequest()).toBe(true)
      expect(currentRequest()?.label).toBe('GET /about')
      expect(currentRequest()?.id).toBe(request.id)
    })
    expect(currentRequest()).toBeUndefined()
  })

  it('keeps overlapping requests apart across await points', async () => {
    const seen: Array<[string, string | undefined]> = []
    const serve = async (label: string, delay: number) => {
      await new Promise(resolve => setTimeout(resolve, delay))
      seen.push([label, currentRequest()?.label])
      await tick()
      seen.push([label, currentRequest()?.label])
    }

    await Promise.all([
      runWithRequest('GET /page', () => serve('GET /page', 4)),
      runWithRequest('GET /_nuxt/app.js', () => serve('GET /_nuxt/app.js', 1)),
      runWithRequest('GET /api/hello', () => serve('GET /api/hello', 2)),
    ])

    expect(seen).toHaveLength(6)
    for (const [label, attributed] of seen) {
      expect(attributed).toBe(label)
    }
  })

  it('follows a request into a nested callback the handler creates', async () => {
    const attributed = await runWithRequest('GET /nested', () => new Promise<string | undefined>((resolve) => {
      process.nextTick(() => {
        setImmediate(() => {
          queueMicrotask(() => resolve(currentRequest()?.label))
        })
      })
    }))
    expect(attributed).toBe('GET /nested')
  })

  it('gives every request its own identity', () => {
    const first = runWithRequest('GET /', request => request.id)
    const second = runWithRequest('GET /', request => request.id)
    expect(second).not.toBe(first)
  })

  it('does not attribute work that has left the request context', async () => {
    let escaped: string | undefined = 'unset'
    runWithRequest('GET /leaky', () => {
      // A queue the handler does not own loses the context, by design.
      queue.push(() => {
        escaped = currentRequest()?.label
      })
    })
    const queued = queue.splice(0)
    for (const run of queued) {
      run()
    }
    await tick()
    expect(escaped).toBeUndefined()
  })
})

describe('log overlay', () => {
  beforeEach(() => {
    copied.length = 0
  })

  const event = (overrides: Partial<Parameters<DevEventLog['push']>[0]> = {}) => ({
    time: 0,
    level: 3,
    type: 'info',
    message: 'hello',
    source: 'cli' as const,
    ...overrides,
  })

  it('opens focused on the newest error', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'all fine' }))
    events.push(event({ message: 'boom', level: 0, type: 'error' }))
    events.push(event({ message: 'afterwards' }))
    const { overlay, lastFrame } = create(events)
    overlay.openAtLastError()
    const selected = strip(lastFrame()).split('\n').filter(line => line.startsWith('▎'))
    expect(selected.join('\n')).toContain('boom')
    expect(selected.join('\n')).not.toContain('afterwards')
  })

  it('closes a hyperlink cut in half, so the rest of the line is not linked', () => {
    const linked = `\u001B]8;;file:///project/app/pages/index.vue\u0007app/pages/index.vue\u001B]8;;\u0007`
    const cut = truncate(`  page  /  ${linked}`, 20)
    expect(strip(cut)).toHaveLength(20)
    expect(cut.endsWith('\u001B]8;;\u0007')).toBe(true)
  })

  it('truncates by visible width and carries styling across the cut', () => {
    const styled = event({ message: `\u001B[32m➜\u001B[39m DevTools: press Shift + A in your browser to enable the DevTools`, level: 2 })
    const timeWidth = new Date(0).toLocaleTimeString().length
    const [line] = formatEvent(styled as any, 40, timeWidth)
    expect(strip(line!).length).toBeLessThanOrEqual(40)
    // The cut must not swallow the reset, or everything after stays green.
    expect(line!.endsWith('\u001B[0m')).toBe(true)
    expect(strip(line!)).toContain('DevTools: press Shift')
  })

  function create(events = new DevEventLog()) {
    let output = ''
    let closed = 0
    const overlay = new LogOverlay(events, (chunk) => {
      output += chunk
    }, () => closed++)
    return {
      overlay,
      events,
      lastFrame: () => output.split('\u001B[H\u001B[2J').at(-1) ?? '',
      output: () => output,
      closed: () => closed,
    }
  }

  it('enters and leaves the alternate buffer', () => {
    const { overlay, output, closed } = create()
    overlay.open()
    expect(output()).toContain('\u001B[?1049h')
    overlay.handleKey({ name: 'q' })
    expect(output()).toContain('\u001B[?1049l')
    expect(closed()).toBe(1)
  })

  it('reflows to the terminal when it is resized while open', async () => {
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true })
    const { overlay, lastFrame } = create()
    try {
      overlay.open()
      expect(strip(lastFrame()).split('\n')[1]).toHaveLength(100)
      Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
      process.stdout.emit('resize')
      await vi.waitFor(() => expect(strip(lastFrame()).split('\n')[1]).toHaveLength(60))
    }
    finally {
      overlay.handleKey({ name: 'q' })
      if (columns) {
        Object.defineProperty(process.stdout, 'columns', columns)
      }
      else {
        Reflect.deleteProperty(process.stdout, 'columns')
      }
    }
  })

  it('stops listening for resizes once it is closed', () => {
    const before = process.stdout.listenerCount('resize')
    const { overlay } = create()
    overlay.open()
    expect(process.stdout.listenerCount('resize')).toBe(before + 1)
    overlay.handleKey({ name: 'q' })
    expect(process.stdout.listenerCount('resize')).toBe(before)
  })

  it('clears the history from the view', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'old news' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    expect(lastFrame()).toContain('old news')
    overlay.handleKey({ name: 'x' })
    expect(lastFrame()).not.toContain('old news')
    expect(events.recent(10)).toEqual([])
  })

  it('renders events and filters by level with a hidden count', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'plain info' }))
    events.push(event({ level: 0, type: 'error', message: 'kaboom' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    expect(strip(lastFrame())).toContain('plain info')
    expect(strip(lastFrame())).toContain('kaboom')

    overlay.handleKey({ name: 'e' })
    expect(strip(lastFrame())).not.toContain('plain info')
    expect(strip(lastFrame())).toContain('kaboom')
    expect(strip(lastFrame())).toContain('1 hidden')
  })

  it('filters by source and never hides everything', () => {
    const events = new DevEventLog()
    events.push(event({ source: 'runtime', message: 'from runtime' }))
    events.push(event({ source: 'build', message: 'from build' }))
    events.push(event({ source: 'cli', message: 'from cli' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()

    overlay.handleKey({ name: 'c' })
    expect(strip(lastFrame())).not.toContain('from cli')
    expect(strip(lastFrame())).toContain('from runtime')
    expect(strip(lastFrame())).toContain('from build')

    overlay.handleKey({ name: 'b' })
    expect(strip(lastFrame())).not.toContain('from build')
    expect(strip(lastFrame())).toContain('from runtime')

    // Turning off the last visible source would leave an empty view.
    overlay.handleKey({ name: 'r' })
    expect(strip(lastFrame())).toContain('from runtime')
  })

  it('heads a request\'s logs once, with the request beside the time', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'first', request: 'GET /about', requestId: 1, source: 'runtime' }))
    events.push(event({ message: 'second', request: 'GET /about', requestId: 1, source: 'runtime' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()

    const lines = strip(lastFrame()).split('\n').filter(line => line.trim())
    const heading = lines.findIndex(line => line.includes('GET /about'))
    expect(lines[heading]).toMatch(/\d:\d\d.*GET \/about/)
    expect(lines[heading + 1]).toContain('first')
    expect(lines[heading + 2]).toContain('second')
    expect(lines.filter(line => line.includes('GET /about'))).toHaveLength(1)
  })

  it('heads each request separately when the same path is hit twice', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'one', request: 'GET /about', requestId: 1, source: 'runtime' }))
    events.push(event({ message: 'two', request: 'GET /about', requestId: 2, source: 'runtime' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    expect(strip(lastFrame()).split('\n').filter(line => line.includes('GET /about'))).toHaveLength(2)
  })

  it('puts the message at the same column whether or not it has a heading', () => {
    const events = new DevEventLog()
    events.push(event({ time: new Date('2024-01-01T10:20:30').getTime(), message: 'plain' }))
    events.push(event({ time: new Date('2024-01-01T10:20:31').getTime(), message: 'grouped', request: 'GET /x', requestId: 1, source: 'runtime' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()

    const lines = strip(lastFrame()).split('\n')
    const plain = lines.find(line => line.includes('plain'))!
    const grouped = lines.find(line => line.includes('grouped'))!
    const heading = lines.find(line => line.includes('GET /x'))!
    expect(grouped.indexOf('grouped')).toBe(plain.indexOf('plain'))
    expect(heading.indexOf('GET /x')).toBe(plain.indexOf('plain'))
  })

  it('starts a new heading when another request interleaves', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'a1', request: 'GET /a', requestId: 1, source: 'runtime' }))
    events.push(event({ message: 'b1', request: 'GET /b', requestId: 2, source: 'runtime' }))
    events.push(event({ message: 'a2', request: 'GET /a', requestId: 1, source: 'runtime' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    expect(strip(lastFrame()).split('\n').filter(line => line.includes('GET /a'))).toHaveLength(2)
  })

  it('searches by the request a log was emitted for', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'rendered', request: 'GET /about', source: 'runtime' }))
    events.push(event({ message: 'unrelated build output', source: 'build' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()

    overlay.handleKey({ sequence: '/' })
    for (const character of '/about') {
      overlay.handleKey({ sequence: character })
    }
    expect(strip(lastFrame())).toContain('rendered')
    expect(strip(lastFrame())).not.toContain('unrelated build output')
  })

  it('filters as you type and restores on escape', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'vite ready' }))
    events.push(event({ message: 'nitro built' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()

    overlay.handleKey({ sequence: '/' })
    for (const character of 'nitro') {
      overlay.handleKey({ sequence: character })
    }
    expect(strip(lastFrame())).toContain('nitro built')
    expect(strip(lastFrame())).not.toContain('vite ready')
    expect(strip(lastFrame())).toContain('search nitro')

    overlay.handleKey({ name: 'backspace' })
    expect(strip(lastFrame())).toContain('search nitr')

    overlay.handleKey({ name: 'escape' })
    expect(strip(lastFrame())).toContain('vite ready')
  })

  it('shows how to leave the search box while typing', () => {
    const { overlay, lastFrame } = create()
    overlay.open()
    overlay.handleKey({ sequence: '/' })
    expect(strip(lastFrame())).toContain('enter apply')
    expect(strip(lastFrame())).toContain('esc cancel')
    expect(strip(lastFrame())).not.toContain('q close')

    overlay.handleKey({ name: 'return' })
    expect(strip(lastFrame())).toContain('q close')
  })

  it('does not treat typed filter keys as shortcuts while searching', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'keep me' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    overlay.handleKey({ sequence: '/' })
    overlay.handleKey({ sequence: 'e', name: 'e' })
    expect(strip(lastFrame())).toContain('search e')
    expect(strip(lastFrame())).not.toContain('error+ only')
  })

  it('selects entries with the arrows and follows the tail again at the end', () => {
    const events = new DevEventLog()
    for (let i = 0; i < 100; i++) {
      events.push(event({ message: `line ${i}` }))
    }
    const { overlay, lastFrame } = create(events)
    overlay.open()
    expect(lastFrame()).not.toContain('\u258E')

    overlay.handleKey({ name: 'up' })
    expect(lastFrame()).toContain('\u258E')
    expect(strip(lastFrame())).toContain('line 99')

    overlay.handleKey({ name: 'g' })
    expect(strip(lastFrame())).toContain('line 0')
    expect(strip(lastFrame())).toContain('scrolled')

    overlay.handleKey({ sequence: 'G', name: 'g' })
    expect(strip(lastFrame())).not.toContain('scrolled')
    expect(lastFrame()).not.toContain('\u258E')
  })

  it('starts at the top when entering the list with the down arrow', () => {
    const events = new DevEventLog()
    for (let i = 0; i < 10; i++) {
      events.push(event({ message: `line ${i}` }))
    }
    const { overlay, lastFrame } = create(events)
    overlay.open()

    overlay.handleKey({ name: 'down' })
    const selected = strip(lastFrame()).split('\n').find(line => line.includes('\u258E'))
    expect(selected).toContain('line 0')
  })

  it('wraps the selection around both ends', () => {
    const events = new DevEventLog()
    for (let i = 0; i < 3; i++) {
      events.push(event({ message: `line ${i}` }))
    }
    const { overlay, lastFrame } = create(events)
    overlay.open()
    const selected = () => strip(lastFrame()).split('\n').find(line => line.includes('\u258E'))

    overlay.handleKey({ name: 'down' })
    expect(selected()).toContain('line 0')

    overlay.handleKey({ name: 'up' })
    expect(selected()).toContain('line 2')

    overlay.handleKey({ name: 'down' })
    expect(selected()).toContain('line 0')
  })

  it('trims the hint line to the terminal, keeping movement and the way out', () => {
    const events = new DevEventLog()
    events.push(event({ message: 'anything' }))
    const { overlay, lastFrame } = create(events)
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      overlay.open()
      const hints = strip(lastFrame()).split('\n').filter(Boolean).at(-1)!
      expect(hints.length).toBeLessThanOrEqual(60)
      expect(hints).toContain('select')
      expect(hints).toContain('q close')
    }
    finally {
      if (columns) {
        Object.defineProperty(process.stdout, 'columns', columns)
      }
      else {
        Reflect.deleteProperty(process.stdout, 'columns')
      }
    }
  })

  it('copies the selected entry, request and all', async () => {
    const events = new DevEventLog()
    events.push(event({ message: 'boom', request: 'GET /x', requestId: 1, source: 'runtime' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    overlay.handleKey({ name: 'up' })
    overlay.handleKey({ name: 'return' })

    await vi.waitFor(() => expect(copied).toHaveLength(1))
    expect(copied[0]).toContain('GET /x')
    expect(copied[0]).toContain('boom')
    await vi.waitFor(() => expect(strip(lastFrame())).toContain('copied to clipboard'))
  })

  it('copies plain text, without colour or hyperlink escapes', async () => {
    const events = new DevEventLog()
    events.push(event({
      message: '\u001B[33mcoloured\u001B[39m \u001B]8;;file:///x.ts\u0007linked\u001B]8;;\u0007',
      source: 'build',
    }))
    const { overlay } = create(events)
    overlay.open()
    overlay.handleKey({ name: 'up' })
    overlay.handleKey({ name: 'y' })

    await vi.waitFor(() => expect(copied).toHaveLength(1))
    expect(copied[0]).toContain('coloured linked')
    expect(copied[0]).not.toContain('\u001B')
  })

  it('says so when there is nothing selected to copy', async () => {
    const events = new DevEventLog()
    events.push(event({ message: 'anything' }))
    const { overlay, lastFrame } = create(events)
    overlay.open()
    overlay.handleKey({ name: 'y' })
    await vi.waitFor(() => expect(strip(lastFrame())).toContain('nothing selected'))
    expect(copied).toHaveLength(0)
  })
})

describe('request log', () => {
  const request = (overrides: Partial<DevRequest> = {}): DevRequest => ({
    time: 0,
    method: 'GET',
    url: '/',
    status: 200,
    duration: 5,
    ...overrides,
  })

  it('counts every request even once dropped from the buffer', () => {
    const log = new RequestLog(2)
    log.push([request(), request(), request()])
    expect(log.total).toBe(3)
    expect(log.recent(10)).toHaveLength(2)
  })

  it('reports the median duration', () => {
    const log = new RequestLog()
    log.push([request({ duration: 1 }), request({ duration: 5 }), request({ duration: 900 })])
    expect(log.medianDuration()).toBe(5)
  })

  it('notifies listeners and exposes the newest request', () => {
    const log = new RequestLog()
    let changes = 0
    log.onChange(() => changes++)
    log.push([request({ url: '/a' }), request({ url: '/b' })])
    expect(changes).toBe(1)
    expect(log.last()?.url).toBe('/b')
  })

  it('excludes bundler requests from the median while app traffic exists', () => {
    const log = new RequestLog()
    log.push([request({ duration: 1, internal: true }), request({ duration: 1, internal: true }), request({ duration: 50 })])
    expect(log.medianDuration()).toBe(50)
  })

  it('clears its history and total, telling listeners', () => {
    const log = new RequestLog()
    let changes = 0
    log.onChange(() => changes++)
    log.push([request()])
    log.clear()
    expect(changes).toBe(2)
    expect(log.total).toBe(0)
    expect(log.recent(10)).toHaveLength(0)
  })
})

describe('request overlay', () => {
  function create(options: { resolveFile?: (request: DevRequest) => string | undefined, cwd?: string, events?: DevEventLog } = {}) {
    const log = new RequestLog()
    let output = ''
    const overlay = new RequestOverlay(log, (chunk) => {
      output += chunk
    }, () => {}, options)
    return { log, overlay, lastFrame: () => strip(output.split('\u001B[H\u001B[2J').at(-1) ?? '') }
  }

  it('waits for traffic before showing a table', () => {
    const { overlay, lastFrame } = create()
    overlay.open()
    expect(lastFrame()).toContain('waiting for requests')
  })

  it('tabulates requests with status and duration', () => {
    const { log, overlay, lastFrame } = create()
    log.push([{ time: 0, method: 'GET', url: '/api/hello', status: 200, duration: 12 }])
    overlay.open()
    expect(lastFrame()).toMatch(/GET\s+200\s+12ms\s+\/api\/hello/)
    expect(lastFrame()).toContain('1 total')
  })

  it('filters to errors and to slow requests', () => {
    const { log, overlay, lastFrame } = create()
    log.push([
      { time: 0, method: 'GET', url: '/fast-ok', status: 200, duration: 3 },
      { time: 0, method: 'GET', url: '/slow-ok', status: 200, duration: 400 },
      { time: 0, method: 'GET', url: '/missing', status: 404, duration: 2 },
    ])
    overlay.open()

    overlay.handleKey({ name: 'e' })
    expect(lastFrame()).toContain('/missing')
    expect(lastFrame()).not.toContain('/fast-ok')

    overlay.handleKey({ name: 'e' })
    overlay.handleKey({ name: 's' })
    expect(lastFrame()).toContain('/slow-ok')
    expect(lastFrame()).not.toContain('/missing')
  })

  it('links a failed request to the error component instead of the route', () => {
    const seen: number[] = []
    const { log, overlay } = create({
      resolveFile: (request) => {
        seen.push(request.status)
        return request.status >= 400 ? '/project/app/error.vue' : '/project/app/pages/index.vue'
      },
      cwd: '/project',
    })
    log.push([{ time: 0, method: 'GET', url: '/missing', status: 404, duration: 2 }])
    overlay.open()
    expect(seen).toContain(404)
  })

  it('links a request to the file that served it', () => {
    const { log, overlay, lastFrame } = create({ resolveFile: () => '/project/server/api/hello.ts', cwd: '/project' })
    log.push([{ time: 0, method: 'GET', url: '/api/hello', status: 200, duration: 3 }])
    overlay.open()
    // The label still reads as the path; the link target is the file.
    expect(lastFrame()).toContain('/api/hello')
  })

  it('searches across method, path and status', () => {
    const { log, overlay, lastFrame } = create()
    log.push([
      { time: 0, method: 'GET', url: '/api/hello', status: 200, duration: 3 },
      { time: 0, method: 'POST', url: '/api/submit', status: 201, duration: 4 },
    ])
    overlay.open()
    overlay.handleKey({ sequence: '/' })
    for (const character of 'post') {
      overlay.handleKey({ sequence: character })
    }
    expect(lastFrame()).toContain('/api/submit')
    expect(lastFrame()).not.toContain('/api/hello')
  })

  it('closes on its own key as well as q', () => {
    const { overlay } = create()
    overlay.open()
    overlay.handleKey({ name: 'n' })
    expect(overlay.isOpen).toBe(false)
  })

  it('hides bundler traffic until asked to show it', () => {
    const { log, overlay, lastFrame } = create()
    log.push([
      { time: 0, method: 'GET', url: '/@id/virtual:nuxt:paths.mjs', status: 200, duration: 1, internal: true },
      { time: 0, method: 'GET', url: '/api/hello', status: 200, duration: 3 },
    ])
    overlay.open()
    expect(lastFrame()).not.toContain('/@id/')
    expect(lastFrame()).toContain('1 bundler hidden')

    overlay.handleKey({ name: 'b' })
    expect(lastFrame()).toContain('/@id/')
  })

  it('marks requests that produced error logs', () => {
    const events = new DevEventLog()
    const { log, overlay, lastFrame } = create({ events })
    const now = Date.now()
    events.push({ time: now, level: 0, type: 'error', message: 'Invalid end tag.', source: 'runtime', request: 'GET /', requestId: 7 })
    log.push([{ id: 7, time: now, method: 'GET', url: '/', status: 500, duration: 20 }])
    overlay.open()
    expect(lastFrame()).toContain('✗ 1')
  })

  it('opens an end-to-end trace for the selected request and returns on escape', () => {
    const events = new DevEventLog()
    const { log, overlay, lastFrame } = create({ events })
    const now = Date.now()
    events.push({ time: now, level: 2, type: 'log', message: 'rendering /', source: 'runtime', request: 'GET /', requestId: 7 })
    events.push({ time: now, level: 0, type: 'error', message: 'Invalid end tag.', source: 'runtime', request: 'GET /', requestId: 7 })
    events.push({ time: now, level: 2, type: 'log', message: 'unrelated', source: 'runtime', request: 'GET /other', requestId: 8 })
    log.push([{ id: 7, time: now, method: 'GET', url: '/', status: 500, duration: 20 }])
    overlay.open()

    overlay.handleKey({ name: 'down' })
    overlay.handleKey({ name: 'return' })
    expect(lastFrame()).toContain('trace')
    expect(lastFrame()).toContain('Invalid end tag.')
    expect(lastFrame()).toContain('rendering /')
    expect(lastFrame()).not.toContain('unrelated')

    overlay.handleKey({ name: 'escape' })
    expect(overlay.isOpen).toBe(true)
    expect(lastFrame()).toContain('traffic')
  })

  it('says so when a request has no attributed logs', () => {
    const events = new DevEventLog()
    const { log, overlay, lastFrame } = create({ events })
    log.push([{ id: 9, time: Date.now(), method: 'GET', url: '/quiet', status: 200, duration: 2 }])
    overlay.open()
    overlay.handleKey({ name: 'down' })
    overlay.handleKey({ name: 'return' })
    expect(lastFrame()).toContain('no logs were captured for this request')
  })
})

describe('help overlay', () => {
  function create() {
    let output = ''
    let closed = 0
    const overlay = new HelpOverlay(
      () => [
        { keys: ['r'], ctrl: 'r', description: 'restart the dev server' },
        { keys: ['R'], description: 'restart with a cleared cache' },
        { keys: ['h', '?'], description: 'show this help' },
      ],
      (chunk) => {
        output += chunk
      },
      () => closed++,
    )
    return { overlay, closed: () => closed, lastFrame: () => strip(output.split('\u001B[H\u001B[2J').at(-1) ?? '') }
  }

  it('lists shortcuts with their aliases instead of logging them', () => {
    const { overlay, lastFrame } = create()
    overlay.open()
    expect(lastFrame()).toContain('r / ctrl-r')
    expect(lastFrame()).toContain('shift-r')
    expect(lastFrame()).toContain('h / ?')
    expect(lastFrame()).toContain('restart the dev server')
  })

  it('closes on h as well as q', () => {
    const { overlay, closed } = create()
    overlay.open()
    overlay.handleKey({ name: 'h' })
    expect(overlay.isOpen).toBe(false)
    expect(closed()).toBe(1)
  })
})

describe('info overlay', () => {
  function create() {
    let output = ''
    const overlay = new InfoOverlay(
      () => [
        { heading: 'versions', entries: [['Nuxt', '4.5.1'], ['Vue', undefined]] },
        { heading: 'urls', entries: [['local', 'http://localhost:3000/']] },
      ],
      (chunk) => {
        output += chunk
      },
      () => {},
    )
    return { overlay, lastFrame: () => strip(output.split('\u001B[H\u001B[2J').at(-1) ?? '') }
  }

  it('groups information under headings', () => {
    const { overlay, lastFrame } = create()
    overlay.open()
    const frame = lastFrame()
    expect(frame).toContain('versions')
    expect(frame).toContain('4.5.1')
    expect(frame).toContain('urls')
    expect(frame).toContain('http://localhost:3000/')
    expect(frame.indexOf('versions')).toBeLessThan(frame.indexOf('urls'))
  })

  it('puts a side panel to the right when there is room', () => {
    let output = ''
    const overlay = new InfoOverlay(
      () => [{ heading: 'urls', entries: [['local', 'http://localhost:3000/']] }],
      (chunk) => {
        output += chunk
      },
      () => {},
      () => 'QR-A\nQR-B',
    )
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    const setColumns = (value: number) =>
      Object.defineProperty(process.stdout, 'columns', { value, configurable: true })
    const frame = () => strip(output.split('\u001B[H\u001B[2J').at(-1) ?? '')

    try {
      setColumns(200)
      overlay.open()
      expect(frame().split('\n').find(line => line.includes('QR-A'))).toContain('urls')

      setColumns(30)
      output = ''
      overlay.close()
      overlay.open()
      expect(frame().split('\n').find(line => line.includes('QR-A'))).not.toContain('urls')
      expect(frame()).toContain('QR-A')
    }
    finally {
      if (columns) {
        Object.defineProperty(process.stdout, 'columns', columns)
      }
      else {
        Reflect.deleteProperty(process.stdout, 'columns')
      }
    }
  })

  it('omits entries with no value', () => {
    const { overlay, lastFrame } = create()
    overlay.open()
    expect(lastFrame()).not.toContain('Vue')
  })
})

describe('route overlay', () => {
  function create() {
    let output = ''
    const overlay = new RouteOverlay((chunk) => {
      output += chunk
    }, () => {}, '/project')
    // Files render relative to the project with the platform's own separator.
    return { overlay, lastFrame: () => strip(output.split('\u001B[H\u001B[2J').at(-1) ?? '').replaceAll('\\', '/') }
  }

  const routes: DevRoute[] = [
    { kind: 'page', route: '/', file: '/project/app/pages/index.vue' },
    { kind: 'page', route: '/about', file: '/project/app/pages/about.vue' },
    { kind: 'server', route: '/api/hello', method: 'get', file: '/project/server/api/hello.ts' },
  ]

  it('waits for routes before listing any', () => {
    const { overlay, lastFrame } = create()
    overlay.open()
    expect(lastFrame()).toContain('waiting for routes')
  })

  it('lists routes with their files relative to the project', () => {
    const { overlay, lastFrame } = create()
    overlay.setRoutes({ routes })
    overlay.open()
    expect(lastFrame()).toContain('2 pages · 1 server')
    expect(lastFrame()).toContain('app/pages/index.vue')
    expect(lastFrame()).not.toContain('/project/app')
    expect(lastFrame()).toContain('GET')
  })

  // The smallest terminal the UI runs in, less the gutter every row reserves.
  it('keeps a row inside a narrow terminal instead of wrapping it', () => {
    const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true })
    const { overlay, lastFrame } = create()
    try {
      overlay.setRoutes({ routes: [
        { kind: 'server', route: '/api/deeply/nested/resource/with/a/long/path', file: '/project/server/api/deeply/nested/resource/with/a/long/path.ts' },
      ] })
      overlay.open()
      for (const line of strip(lastFrame()).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(40)
      }
    }
    finally {
      overlay.handleKey({ name: 'q' })
      if (columns) {
        Object.defineProperty(process.stdout, 'columns', columns)
      }
      else {
        Reflect.deleteProperty(process.stdout, 'columns')
      }
    }
  })

  it('sorts routes by path and filters by kind', () => {
    const { overlay, lastFrame } = create()
    overlay.setRoutes({ routes })
    overlay.open()
    expect(lastFrame().indexOf('/about')).toBeLessThan(lastFrame().indexOf('/api/hello'))

    overlay.handleKey({ name: 's' })
    expect(lastFrame()).toContain('/api/hello')
    expect(lastFrame()).not.toContain('/about')
  })

  it('resolves the file serving a url, preferring the most specific route', () => {
    const { overlay } = create()
    overlay.setRoutes({ routes: [
      ...routes,
      { kind: 'page', route: '/**', file: '/project/app/pages/[...slug].vue' },
      { kind: 'server', route: '/api/users/:id', file: '/project/server/api/users/[id].ts' },
    ] })
    expect(overlay.fileFor('/api/hello')).toBe('/project/server/api/hello.ts')
    expect(overlay.fileFor('/api/users/42')).toBe('/project/server/api/users/[id].ts')
    expect(overlay.fileFor('/api/hello?q=1')).toBe('/project/server/api/hello.ts')
    expect(overlay.fileFor('/anything/else')).toBe('/project/app/pages/[...slug].vue')
  })

  it('replaces routes when the app reports them again', async () => {
    const { overlay, lastFrame } = create()
    overlay.setRoutes({ routes })
    overlay.open()
    overlay.setRoutes({ routes: [{ kind: 'page', route: '/only', file: '/project/app/pages/only.vue' }] })
    // Repaints from the data source are throttled.
    await vi.waitFor(() => expect(lastFrame()).toContain('/only'))
    expect(lastFrame()).not.toContain('/about')
  })
})

describe('panel surface', () => {
  it('keeps the panel pinned below log output', async () => {
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      process.stdout.write('first log line\n')
      process.stdout.write('second log line\n')
      await new Promise(resolve => setTimeout(resolve, 40))
      surface.close()
    })

    const frame = screen(renderer)
    const lines = frame.split('\n').filter(Boolean)
    expect(lines).toEqual(['first log line', 'second log line'])
  })

  it('shows the footer after the latest output while active', async () => {
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      process.stdout.write('a log line\n')
      await new Promise(resolve => setTimeout(resolve, 40))
    })

    const frame = screen(renderer)
    expect(frame.indexOf('a log line')).toBeLessThan(frame.indexOf('--- footer ---'))
  })

  function withStubbedTerminal(rows: number, run: (written: () => string) => void): void {
    const chunks: string[] = []
    const descriptors = (['rows', 'isTTY'] as const).map(key => [key, Object.getOwnPropertyDescriptor(process.stdout, key)] as const)
    Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      run(() => chunks.join(''))
    }
    finally {
      write.mockRestore()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(process.stdout, key, descriptor)
        }
        else {
          Reflect.deleteProperty(process.stdout, key)
        }
      }
    }
  }

  it('pads the screen so the footer starts at the bottom', () => {
    withStubbedTerminal(10, (written) => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      surface.padToBottom()
      surface.close()
      // Ten rows, less the footer line and the row it rests on.
      expect(written()).toContain('\n'.repeat(8))
    })
  })

  it('counts output already on screen so padding does not push history away', () => {
    withStubbedTerminal(10, (written) => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      for (let i = 0; i < 6; i++) {
        process.stdout.write(`line ${i}\n`)
      }
      surface.padToBottom()
      surface.close()
      expect(written()).not.toContain('\n'.repeat(4))
      expect(written()).toContain('\n'.repeat(2))
    })
  })

  it('asks its owner to re-render on resize rather than reusing stale lines', async () => {
    let resized = 0
    await render(async () => {
      const surface = new PanelSurface({ onResize: () => resized++ })
      surface.render(['--- footer ---'])
      process.stdout.emit('resize')
      await new Promise(resolve => setTimeout(resolve, 5))
      surface.close()
    })

    expect(resized).toBe(1)
  })

  it('re-seats the panel at the bottom when the window grows', () => {
    withStubbedTerminal(10, (written) => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      surface.padToBottom()
      const before = written().length
      Object.defineProperty(process.stdout, 'rows', { value: 20, configurable: true })
      process.stdout.emit('resize')
      surface.close()
      expect(written().slice(before)).toContain('\n'.repeat(10))
    })
  })

  it('does not pad a shrinking window, which would push history away', () => {
    withStubbedTerminal(20, (written) => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      surface.padToBottom()
      const before = written().length
      Object.defineProperty(process.stdout, 'rows', { value: 10, configurable: true })
      process.stdout.emit('resize')
      surface.close()
      expect(written().slice(before)).not.toContain('\n\n')
    })
  })

  it('does not paint the footer while a view owns the screen', async () => {
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      surface.screenMode = 'alternate-screen'
      surface.render(['--- updated footer ---'])
      await new Promise(resolve => setTimeout(resolve, 5))
      surface.close()
    })

    expect(screen(renderer)).not.toContain('updated footer')
  })

  it('flushes queued output rather than dropping it when it closes', async () => {
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      surface.screenMode = 'alternate-screen'
      process.stdout.write('a warning nobody would see\n')
      await new Promise(resolve => setTimeout(resolve, 20))
      surface.close()
    })

    expect(screen(renderer)).toContain('a warning nobody would see')
  })

  it('queues output while a view owns the screen and flushes it after', async () => {
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      surface.screenMode = 'alternate-screen'
      process.stdout.write('written while the view was open\n')
      surface.screenMode = 'split-footer'
      await new Promise(resolve => setTimeout(resolve, 5))
      surface.close()
    })

    expect(screen(renderer)).toContain('written while the view was open')
  })

  it('folds queued output away when it is being captured, as at any other time', async () => {
    const captured: string[] = []
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.onExternalOutput(chunk => captured.push(chunk))
      surface.externalOutput = 'capture'
      surface.render(['--- footer ---'])
      surface.screenMode = 'alternate-screen'
      process.stdout.write('build output nobody asked to see\n')
      surface.screenMode = 'split-footer'
      await new Promise(resolve => setTimeout(resolve, 5))
      surface.close()
    })

    expect(captured.join('')).toContain('build output nobody asked to see')
    expect(screen(renderer)).not.toContain('build output nobody asked to see')
  })

  it('holds an error back until a view has given the screen back', () => {
    withStubbedTerminal(24, (written) => {
      const surface = new PanelSurface()
      surface.onExternalOutput(() => {})
      surface.externalOutput = 'capture'
      surface.render(['--- footer ---'])
      surface.screenMode = 'alternate-screen'
      surface.writeAbove('ERROR the build failed')
      expect(written()).not.toContain('ERROR the build failed')
      surface.screenMode = 'split-footer'
      expect(written()).toContain('ERROR the build failed\n')
      surface.close()
    })
  })

  it('does not stack footers across repaints', async () => {
    const renderer = await render(async () => {
      const surface = new PanelSurface()
      surface.render(['--- footer ---'])
      for (let i = 0; i < 5; i++) {
        process.stdout.write(`log ${i}\n`)
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    })

    const frame = screen(renderer)
    expect(frame.match(/--- footer ---/g)).toHaveLength(1)
    expect(frame).toContain('log 4')
  })
})

describe('release notes links', () => {
  const linked = (label: string, url: string) => {
    // Terminal detection has many inputs; this is the switch that overrides them.
    vi.stubEnv('FORCE_HYPERLINK', '1')
    try {
      return terminalLink(label, url, { stream: { isTTY: true } })
    }
    finally {
      vi.unstubAllEnvs()
    }
  }

  it('points at the tag for packages with a known repository', () => {
    expect(releaseNotesUrl('nuxt', '4.6.0')).toBe('https://github.com/nuxt/nuxt/releases/tag/v4.6.0')
    expect(releaseNotesUrl('@nuxt/cli', '3.1.0')).toBe('https://github.com/nuxt/cli/releases/tag/v3.1.0')
  })

  it('has nothing to link for nightlies or unknown packages', () => {
    expect(releaseNotesUrl('nuxt', '4.6.0-nightly.20240101')).toBeUndefined()
    expect(releaseNotesUrl('some-other-package', '1.0.0')).toBeUndefined()
  })

  it('emits a hyperlink only where the terminal supports one', () => {
    expect(terminalLink('4.6.0', 'https://example.com', { stream: { isTTY: false } })).toBe('4.6.0')
  })

  it('links the running version as well as the update', () => {
    const link = linked('4.5.1', 'https://github.com/nuxt/nuxt/releases/tag/v4.5.1')
    const lines = renderPanel({ status: 'ready', version: '4.5.1', versionLink: link, hints: HINTS }, 100, 30)
    expect(lines[0]).toContain('releases/tag/v4.5.1')
    expect(strip(lines[0]!)).toContain('Nuxt 4.5.1')
  })

  it('keeps a linked version from skewing the panel width', () => {
    const link = linked('→ 4.6.0', 'https://example.com')
    const versionLink = linked('4.5.1', 'https://example.com/v4.5.1')
    const withLinks = renderPanel({ status: 'ready', version: '4.5.1', versionLink, update: '4.6.0', updateLink: link, hints: HINTS, readyMs: 900 }, 100, 30)
    const plain = renderPanel({ status: 'ready', version: '4.5.1', update: '4.6.0', hints: HINTS, readyMs: 900 }, 100, 30)
    expect(strip(withLinks[0]!)).toBe(strip(plain[0]!))
  })
})

describe('dev ui teardown', () => {
  const ENTER_ALT = '\u001B[?1049h'
  const LEAVE_ALT = '\u001B[?1049l'
  const HIDE_CURSOR = '\u001B[?25l'
  const SHOW_CURSOR = '\u001B[?25h'

  interface Session {
    written: () => string
    session: NonNullable<ReturnType<typeof beginDevUI>>
    isRaw: () => boolean
    listeners: () => number
  }

  const signals = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException'] as const

  async function withTerminal(run: (context: Session) => void | Promise<void>): Promise<void> {
    const chunks: string[] = []
    let raw = false
    const stdoutKeys = ['isTTY', 'columns', 'rows'] as const
    const saved = [
      ...stdoutKeys.map(key => [process.stdout, key, Object.getOwnPropertyDescriptor(process.stdout, key)] as const),
      [process.stdin, 'isTTY', Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')] as const,
      [process.stdin, 'setRawMode', Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode')] as const,
    ]
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true })
    Object.defineProperty(process.stdout, 'rows', { value: 30, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: (next: boolean) => {
        raw = next
        return process.stdin
      },
      configurable: true,
    })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    })

    const session = beginDevUI({ ci: false, test: false, version: '4.5.2' })!
    try {
      await run({
        session,
        written: () => chunks.join(''),
        isRaw: () => raw,
        listeners: () => signals.reduce((total, signal) => total + process.listenerCount(signal), 0),
      })
    }
    finally {
      session.teardown()
      write.mockRestore()
      for (const [target, key, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(target, key, descriptor)
        }
        else {
          Reflect.deleteProperty(target, key)
        }
      }
    }
  }

  it('surfaces errors still waiting on their delay when it tears down', async () => {
    await withTerminal(({ session, written }) => {
      session.events.push({ time: Date.now(), level: 0, type: 'error', message: 'the server could not start', source: 'cli' })
      const before = written().length
      session.teardown()
      expect(written().slice(before)).toContain('the server could not start')
    })
  })

  it('surfaces an error once, not again on the way out', async () => {
    await withTerminal(async ({ session, written }) => {
      session.events.push({ time: Date.now(), level: 0, type: 'error', message: 'the server could not start', source: 'cli' })
      await vi.waitFor(() => expect(written()).toContain('the server could not start'))
      const before = written().length
      session.teardown()
      expect(written().slice(before)).not.toContain('the server could not start')
    })
  })

  it('takes the terminal before anything has been loaded', async () => {
    await withTerminal(({ written }) => {
      expect(strip(written())).toContain('Nuxt 4.5.2')
      expect(strip(written())).toContain('STARTING')
    })
  })

  it('should leave the panel up when a restart handler will keep the process alive', async () => {
    await withTerminal(({ session, written, isRaw }) => {
      const detach = attachKeys(() => {})
      session.onTeardown(detach)
      const restartHandler = Object.assign(() => {}, { [KEEPS_PROCESS_ALIVE]: true })
      process.on('uncaughtException', restartHandler)
      const before = written().length
      try {
        process.emit('uncaughtException', new Error('boom'))
      }
      finally {
        process.off('uncaughtException', restartHandler)
      }

      expect(isRaw()).toBe(true)
      expect(written().slice(before)).not.toContain(SHOW_CURSOR)
    })
  })

  it.each(signals)('gives the terminal back on %s', async (signal) => {
    await withTerminal(({ session, written, isRaw }) => {
      const detach = attachKeys(() => {})
      session.onTeardown(detach)
      expect(isRaw()).toBe(true)

      const before = written().length
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      process.emit(signal as 'SIGINT', new Error('boom') as never)
      exit.mockRestore()
      error.mockRestore()

      expect(isRaw()).toBe(false)
      expect(written().slice(before)).toContain(SHOW_CURSOR)
    })
  })

  it('leaves the alternate buffer when an overlay is open as it exits', async () => {
    await withTerminal(({ session, written }) => {
      const overlay = new LogOverlay(session.events, chunk => session.surface.writeRaw(chunk), () => {})
      session.onTeardown(() => overlay.close())
      overlay.open()
      expect(written()).toContain(ENTER_ALT)

      const before = written().length
      session.teardown()
      expect(written().slice(before)).toContain(LEAVE_ALT)
      expect(written().slice(before)).toContain(SHOW_CURSOR)
      expect(written().slice(before).lastIndexOf(HIDE_CURSOR)).toBe(-1)
    })
  })

  it('removes its signal handlers so nothing is left listening', async () => {
    await withTerminal(({ session, listeners }) => {
      const held = listeners()
      session.teardown()
      expect(listeners()).toBe(held - signals.length)
    })
  })

  it('is safe to tear down more than once', async () => {
    await withTerminal(({ session }) => {
      session.teardown()
      expect(() => session.teardown()).not.toThrow()
      expect(() => session.teardown({ keep: true })).not.toThrow()
    })
  })

  it('stops intercepting output once it is gone', async () => {
    await withTerminal(({ session, written }) => {
      session.teardown()
      const before = written().length
      process.stdout.write('after teardown\n')
      expect(written().slice(before)).toContain('after teardown')
    })
  })

  it('re-renders on resize rather than reusing lines laid out for the old width', async () => {
    await withTerminal(({ written }) => {
      const before = written().length
      Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
      process.stdout.emit('resize')
      // eslint-disable-next-line no-control-regex
      const plain = written().slice(before).replaceAll(/\u001B\[[0-9;]*[A-Z]|\u001B\]8;[^\u0007]*\u0007/gi, '')
      for (const line of plain.replaceAll('\r', '').split('\n')) {
        expect(line.length).toBeLessThanOrEqual(60)
      }
    })
  })
})

describe('dev ui fallback', () => {
  const context = {
    listener: { url: 'http://localhost:3000/', getURLs: () => [], showURLs: () => {} },
    close: async () => {},
    onReady: () => {},
  }

  it('writes no escape sequences when stdout is not a terminal', () => {
    const chunks: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      const ui = setupDevUI(context as never, { ci: false, test: false, stdout: { isTTY: false } })
      ui.setStatus('building')
      ui.pushRequests([{ method: 'GET', url: '/', status: 200, duration: 1 }])
      expect(ui.interactive).toBe(false)
      // eslint-disable-next-line no-control-regex
      expect(chunks.join('')).not.toMatch(/\u001B\[\?(?:1049|25)/)
    }
    finally {
      write.mockRestore()
    }
  })

  it('keeps the line-based shortcuts working when it steps aside', () => {
    expect(setupDevUI(context as never, { enabled: false }).interactive).toBe(false)
  })
})
