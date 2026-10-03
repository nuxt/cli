// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;]*m|\u001B\]8;[^\u0007]*\u0007/g
// eslint-disable-next-line no-control-regex
const NARROW_RE = /^[\u0000-\u02FF\u2010-\u2027\u2500-\u257F\u2800-\u28FF]*$/
const ZERO_WIDTH_RE = /[\p{Mn}\p{Me}\u200B-\u200F]/u
const WIDE_RE = /[\p{Emoji_Presentation}\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u

/** Strip colour and hyperlink escapes, leaving the characters a user sees. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** Columns a single character occupies in a terminal. */
function charWidth(char: string): number {
  if (ZERO_WIDTH_RE.test(char)) {
    return 0
  }
  return WIDE_RE.test(char) ? 2 : 1
}

/** Columns `text` occupies once escape sequences are discounted. */
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
