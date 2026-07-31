import { styleText } from 'node:util'

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

/**
 * Colour the tokens of a JSON document, leaving its text untouched.
 *
 * `styleText` writes no escapes when stdout cannot show them, so piped output
 * stays parseable by `jq` and friends.
 */
export function highlightJson(json: string): string {
  return json.replace(TOKEN_RE, (match, string: string | undefined, colon: string | undefined) => {
    if (string) {
      return colon ? `${styleText('blue', string)}${colon}` : styleText('green', string)
    }
    if (match === 'null') {
      return styleText('dim', match)
    }
    if (match === 'true' || match === 'false') {
      return styleText('yellow', match)
    }
    return styleText('magenta', match)
  })
}
