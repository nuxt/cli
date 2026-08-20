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

/**
 * Cut `text` to `columns`, ignoring escape sequences when measuring and
 * carrying them across the cut so a truncated line cannot leak its styling
 * onto the rest of the screen.
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
  ANSI_RE.lastIndex = 0
  while (index < text.length && visible < limit) {
    ANSI_RE.lastIndex = index
    const match = ANSI_RE.exec(text)
    if (match?.index === index) {
      styled = true
      index += match[0].length
      continue
    }
    index++
    visible++
  }
  return `${text.slice(0, index)}\u2026${styled ? '\u001B[0m' : ''}`
}
