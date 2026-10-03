const NEEDS_QUOTING_RE = /[\s"'$`\\]/
const SINGLE_QUOTE_RE = /'/g
const BACKSLASHES_BEFORE_QUOTE_RE = /(\\*)"/g
const TRAILING_BACKSLASHES_RE = /(\\*)$/

/**
 * Quote a value so the shell passes it through unchanged. POSIX shells still
 * expand `$` and backticks inside double quotes, so single quotes are used
 * there; cmd.exe and PowerShell have no single-quoted form in common.
 *
 * Windows argument parsing only treats a backslash as an escape when a quote
 * follows it, so each run of backslashes is doubled in exactly those two places
 * it would otherwise escape the quote we are adding.
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
