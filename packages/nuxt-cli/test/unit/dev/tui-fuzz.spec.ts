import type { PanelState } from '../../../src/dev/tui/panel'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { renderPanel } from '../../../src/dev/tui/panel'
import { stripAnsi, truncate, visibleWidth } from '../../../src/dev/tui/width'

const RUNS = Number(process.env.NUXT_CLI_FUZZ_RUNS) || 500

const SGR = '\u001B[36m'
const RESET = '\u001B[0m'
const LINK_OPEN = '\u001B]8;;https://nuxt.com\u0007'
const LINK_CLOSE = '\u001B]8;;\u0007'

/** Text made of visible characters and the escape sequences the TUI emits. */
const styledText = fc.array(
  fc.oneof(
    { weight: 8, arbitrary: fc.stringMatching(/^[\w !@./:-]{1,6}$/) },
    { weight: 2, arbitrary: fc.constantFrom(SGR, RESET, LINK_OPEN, LINK_CLOSE) },
    { weight: 1, arbitrary: fc.constantFrom('\u2026', '\u00B7', '\u280B') },
  ),
  { maxLength: 12 },
).map(parts => parts.join(''))

/** Whether `text` leaves a hyperlink open, which would turn the rest of the screen into a link. */
function leavesLinkOpen(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  const escapes = text.match(/\u001B\]8;[^\u0007]*\u0007/g)
  return escapes !== null && escapes.at(-1) !== LINK_CLOSE
}

describe('truncate', () => {
  it('should never exceed the requested number of columns', () => {
    fc.assert(fc.property(styledText, fc.integer({ min: -3, max: 40 }), (text, columns) => {
      expect(visibleWidth(truncate(text, columns))).toBeLessThanOrEqual(Math.max(0, columns))
    }), { numRuns: RUNS })
  })

  it('should leave text that already fits untouched', () => {
    fc.assert(fc.property(styledText, fc.integer({ min: 1, max: 40 }), (text, columns) => {
      fc.pre(visibleWidth(text) <= columns)
      expect(truncate(text, columns)).toBe(text)
    }), { numRuns: RUNS })
  })

  it('should keep the visible prefix of what it cut', () => {
    fc.assert(fc.property(styledText, fc.integer({ min: 1, max: 40 }), (text, columns) => {
      const result = stripAnsi(truncate(text, columns))
      fc.pre(result.endsWith('\u2026'))
      expect(stripAnsi(text).startsWith(result.slice(0, -1))).toBe(true)
    }), { numRuns: RUNS })
  })

  it('should close a hyperlink it cut into', () => {
    fc.assert(fc.property(styledText, fc.integer({ min: 1, max: 40 }), (text, columns) => {
      fc.pre(!leavesLinkOpen(text))

      expect(leavesLinkOpen(truncate(text, columns))).toBe(false)
    }), { numRuns: RUNS })
  })

  it('should end reset when it cut into styled text', () => {
    fc.assert(fc.property(styledText, fc.integer({ min: 1, max: 40 }), (text, columns) => {
      const result = truncate(text, columns)
      fc.pre(result !== text && result.includes(SGR))
      expect(result.endsWith(RESET)).toBe(true)
    }), { numRuns: RUNS })
  })
})

const url = fc.record({
  label: fc.constantFrom('Local', 'Network', 'Tunnel', 'Public', 'A rather long label'),
  url: fc.constantFrom('http://localhost:3000/', 'http://192.168.1.4:3000/', `http://${'x'.repeat(60)}.example.com:3000/some/deep/path`),
  link: fc.option(fc.constant(`${LINK_OPEN}http://localhost:3000/${LINK_CLOSE}`), { nil: undefined }),
  style: fc.constantFrom<'cyan' | 'magenta' | undefined>('cyan', 'magenta', undefined),
  pending: fc.option(fc.boolean(), { nil: undefined }),
})

const hint = fc.record({
  key: fc.constantFrom('r', 'o', 'i', 'l', 'n', 'p', '?', 'q'),
  label: fc.constantFrom('restart', 'open', 'info', 'logs', 'network', 'routes', 'help', 'quit'),
  priority: fc.integer({ min: 0, max: 100 }),
})

const panelState: fc.Arbitrary<PanelState> = fc.record({
  status: fc.constantFrom('starting', 'building', 'warming', 'ready', 'restarting', 'error'),
  version: fc.option(fc.constantFrom('4.5.2', '5.0.0-alpha.1'), { nil: undefined }),
  versionLink: fc.option(fc.constant(`${LINK_OPEN}4.5.2${LINK_CLOSE}`), { nil: undefined }),
  update: fc.option(fc.constant('5.0.0'), { nil: undefined }),
  updateLink: fc.option(fc.constant(`${LINK_OPEN}5.0.0${LINK_CLOSE}`), { nil: undefined }),
  urls: fc.option(fc.array(url, { maxLength: 4 }), { nil: undefined }),
  readyMs: fc.option(fc.integer({ min: 0, max: 5_000_000 }), { nil: undefined }),
  awaitingFirstRender: fc.option(fc.boolean(), { nil: undefined }),
  elapsedMs: fc.option(fc.integer({ min: 0, max: 5_000_000 }), { nil: undefined }),
  progress: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  phaseElapsedMs: fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: undefined }),
  requests: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
  medianMs: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
  warnings: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
  errors: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
  failures: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
  lastRequest: fc.option(fc.record({
    method: fc.constantFrom('GET', 'POST', 'DELETE'),
    url: fc.constantFrom('/', '/api/really/quite/long/path?with=query&and=more', `/${'segment/'.repeat(20)}`),
    status: fc.constantFrom(200, 304, 404, 500),
    duration: fc.integer({ min: 0, max: 60_000 }),
  }), { nil: undefined }),
  frame: fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
  active: fc.option(fc.boolean(), { nil: undefined }),
  note: fc.option(fc.constantFrom('nuxt.config.ts changed', 'a'.repeat(120)), { nil: undefined }),
  rendering: fc.option(fc.record({ label: fc.constantFrom('/', '/blog/'.repeat(20)), startedAt: fc.constant(0) }), { nil: undefined }),
  renderingMs: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
  notice: fc.option(fc.record({
    text: fc.constantFrom('copied', 'x'.repeat(140)),
    tone: fc.constantFrom<'info' | 'warn' | 'success'>('info', 'warn', 'success'),
    label: fc.option(fc.constantFrom('press y', 'y'.repeat(40)), { nil: undefined }),
  }), { nil: undefined }),
  task: fc.option(fc.record({ label: fc.constantFrom('Installing dependencies', 'z'.repeat(100)), startedAt: fc.constant(Date.now()) }), { nil: undefined }),
  confirmQuit: fc.option(fc.boolean(), { nil: undefined }),
  hints: fc.option(fc.uniqueArray(hint, { maxLength: 8, selector: value => value.key }), { nil: undefined }),
  hintsDimmed: fc.option(fc.boolean(), { nil: undefined }),
  ascii: fc.option(fc.boolean(), { nil: undefined }),
  background: fc.constantFrom<'light' | 'dark' | undefined>('light', 'dark', undefined),
}) as fc.Arbitrary<PanelState>

describe('renderPanel', () => {
  it('should keep every line inside the terminal width', () => {
    fc.assert(fc.property(panelState, fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 60 }), (state, columns, rows) => {
      const lines = renderPanel(state, columns, rows)
      const context = JSON.stringify({ state, columns, rows })

      for (const line of lines) {
        expect(visibleWidth(line), `${context}\n${JSON.stringify(line)}`).toBeLessThanOrEqual(Math.max(1, columns))
      }
    }), { numRuns: RUNS })
  })

  it('should fit the panel into the rows it was given', () => {
    fc.assert(fc.property(panelState, fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 60 }), (state, columns, rows) => {
      const lines = renderPanel(state, columns, rows)

      expect(lines.length, JSON.stringify({ state, columns, rows })).toBeLessThanOrEqual(Math.max(2, Math.min(rows - 1, 14)))
    }), { numRuns: RUNS })
  })

  it('should never emit a line containing a newline', () => {
    fc.assert(fc.property(panelState, fc.integer({ min: 1, max: 200 }), (state, columns) => {
      for (const line of renderPanel(state, columns, 30)) {
        expect(line).not.toMatch(/[\n\r]/)
      }
    }), { numRuns: RUNS })
  })

  it('should never leave a hyperlink open at the end of a line', () => {
    fc.assert(fc.property(panelState, fc.integer({ min: 1, max: 200 }), (state, columns) => {
      for (const line of renderPanel(state, columns, 30)) {
        expect(leavesLinkOpen(line), JSON.stringify(line)).toBe(false)
      }
    }), { numRuns: RUNS })
  })

  it('should render the same state the same way', () => {
    fc.assert(fc.property(panelState, fc.integer({ min: 1, max: 200 }), (state, columns) => {
      // Elapsed clocks are read from the state rather than from `Date.now`, so a
      // resize re-render cannot change what the panel says.
      fc.pre(state.task === undefined)

      expect(renderPanel(state, columns, 30)).toEqual(renderPanel(state, columns, 30))
    }), { numRuns: RUNS })
  })
})
