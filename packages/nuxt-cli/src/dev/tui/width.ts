// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;]*m|\u001B\]8;[^\u0007]*\u0007/g

/** Strip colour and hyperlink escapes, leaving the characters a user sees. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** Columns `text` occupies once escape sequences are discounted. */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length
}

/** Ends whatever the cut interrupted, so nothing leaks onto the next line. */
const LINK_TERMINATOR = '\u001B]8;;\u0007'

/**
 * Cut `text` to `columns`, ignoring escape sequences when measuring and closing
 * whatever they opened, so a truncated line cannot leak its styling or turn the
 * rest of the screen into a hyperlink.
 */
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
    index++
    visible++
  }
  return `${text.slice(0, index)}\u2026${linked ? LINK_TERMINATOR : ''}${styled ? '\u001B[0m' : ''}`
}
