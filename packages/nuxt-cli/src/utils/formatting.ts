import process from 'node:process'
import { styleText } from 'node:util'

import { supportsHyperlinks } from 'clickable-path'

/** Render `label` as an OSC 8 link to `url`, where `clickable-path` reports support. */
export function terminalLink(label: string, url: string, options: { stream?: { isTTY?: boolean } } = {}): string {
  if (!supportsHyperlinks(options.stream ?? process.stdout)) {
    return label
  }
  return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;]*m|\u001B\]8;[^\u0007]*\u0007/g
// eslint-disable-next-line no-control-regex
const NARROW_RE = /^[\u0000-\u02FF\u2010-\u2027\u2500-\u257F\u2800-\u28FF]*$/
// `\p{}` literals are compiled at parse time, so these are built on first use.
let widthPatterns: { zero: RegExp, wide: RegExp } | undefined

function getWidthPatterns(): { zero: RegExp, wide: RegExp } {
  return widthPatterns ??= {
    // eslint-disable-next-line prefer-regex-literals
    zero: new RegExp(String.raw`[\p{Mn}\p{Me}\u200B-\u200F]`, 'u'),
    // eslint-disable-next-line prefer-regex-literals
    wide: new RegExp(String.raw`[\p{Emoji_Presentation}\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]`, 'u'),
  }
}

/** Strip colour and hyperlink escapes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function charWidth(char: string): number {
  const { zero, wide } = getWidthPatterns()
  if (zero.test(char)) {
    return 0
  }
  return wide.test(char) ? 2 : 1
}

/** Terminal columns `text` occupies. */
export function visibleWidth(text: string): number {
  const stripped = stripAnsi(text)
  if (NARROW_RE.test(stripped)) {
    return stripped.length
  }
  let width = 0
  for (const char of stripped) {
    width += charWidth(char)
  }
  return width
}

const LINK_TERMINATOR = '\u001B]8;;\u0007'

/** Cut `text` to `columns` with an ellipsis, closing any styling or link it cuts through. */
export function truncate(text: string, columns: number): string {
  if (columns <= 0) {
    return ''
  }
  if (visibleWidth(text) <= columns) {
    return text
  }

  const limit = columns - 1
  let visible = 0
  let index = 0
  let styled = false
  let linked = false
  ANSI_RE.lastIndex = 0
  while (index < text.length && visible < limit) {
    ANSI_RE.lastIndex = index
    const match = ANSI_RE.exec(text)
    if (match?.index === index) {
      if (match[0].startsWith('\u001B]8;')) {
        linked = match[0] !== LINK_TERMINATOR
      }
      else {
        styled = true
      }
      index += match[0].length
      continue
    }
    const code = text.codePointAt(index)!
    const char = code < 0x300 ? text[index]! : String.fromCodePoint(code)
    const width = code < 0x300 ? 1 : charWidth(char)
    if (visible + width > limit) {
      break
    }
    index += char.length
    visible += width
  }
  return `${text.slice(0, index)}\u2026${linked ? LINK_TERMINATOR : ''}${styled ? '\u001B[0m' : ''}`
}

/** Lower-case a leading capital, leaving acronyms alone. */
export function decapitalise(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text
}

/** Format milliseconds with fixed precision per unit (`4.2ms`, `420ms`, `4.20s`, `42.0s`, `4m 02s`, `1h 04m 02s`). */
export function formatDuration(ms: number): string {
  ms = Math.max(0, ms)
  if (ms < 10) {
    return `${ms.toFixed(1)}ms`
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 10_000) {
    return `${(Math.floor(ms / 10) / 100).toFixed(2)}s`
  }
  if (ms < 60_000) {
    return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  }

  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours
    ? `${hours}h ${String(minutes).padStart(2, '0')}m ${seconds}s`
    : `${minutes}m ${seconds}s`
}

const AT_MENTION_RE = /\b@([^, ]+)/g
const BACKTICK_RE = /`([^`]*)`/g

export function formatInfoBox(infoObj: Record<string, string | undefined>): string {
  let firstColumnLength = 0
  let ansiFirstColumnLength = 0
  const entries = Object.entries(infoObj).map(([label, val]) => {
    if (label.length > firstColumnLength) {
      ansiFirstColumnLength = styleText(['bold', 'whiteBright'], label).length + 6
      firstColumnLength = label.length + 6
    }
    return [label, val || '-'] as const
  })

  const terminalWidth = Math.max(process.stdout.columns || 80, firstColumnLength) - 8 /* box padding + extra margin */

  let boxStr = ''
  for (const [label, value] of entries) {
    const formattedValue = value
      .replace(AT_MENTION_RE, (_, r) => styleText('gray', ` ${r}`))
      .replace(BACKTICK_RE, (_, r) => r)

    boxStr += styleText(['bold', 'whiteBright'], label).padEnd(ansiFirstColumnLength)

    let boxRowLength = firstColumnLength

    const words = formattedValue.split(' ')
    let currentLine = ''

    for (const word of words) {
      const wordLength = visibleWidth(word)
      const spaceLength = currentLine ? 1 : 0

      if (boxRowLength + wordLength + spaceLength > terminalWidth) {
        if (currentLine) {
          boxStr += styleText('cyan', currentLine)
        }
        boxStr += `\n${' '.repeat(firstColumnLength)}`
        currentLine = word
        boxRowLength = firstColumnLength + wordLength
      }
      else {
        currentLine += (currentLine ? ' ' : '') + word
        boxRowLength += wordLength + spaceLength
      }
    }

    if (currentLine) {
      boxStr += styleText('cyan', currentLine)
    }

    boxStr += '\n'
  }

  return boxStr
}
