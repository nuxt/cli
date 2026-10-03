const NEEDS_QUOTING_RE = /[\s"'$`\\]/
const SINGLE_QUOTE_RE = /'/g
const BACKSLASHES_BEFORE_QUOTE_RE = /(\\*)"/g
const TRAILING_BACKSLASHES_RE = /(\\*)$/

/**
 * Quote `value` for the shell: single quotes on POSIX (where `$` expands inside
 * double quotes), double quotes on Windows with backslashes doubled before a quote.
 */
export function quoteArgument(value: string, windows: boolean): string {
  if (!NEEDS_QUOTING_RE.test(value)) {
    return value
  }
  if (!windows) {
    return `'${value.replace(SINGLE_QUOTE_RE, `'\\''`)}'`
  }
  const escaped = value
    .replace(BACKSLASHES_BEFORE_QUOTE_RE, '$1$1\\"')
    .replace(TRAILING_BACKSLASHES_RE, '$1$1')
  return `"${escaped}"`
}
