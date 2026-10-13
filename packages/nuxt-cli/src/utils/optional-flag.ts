/**
 * Give a string flag an optional value. Node's `parseArgs` (with `strict: false`)
 * takes the next token as a string flag's value even when it is another flag or
 * the project directory, so `--tunnel --port 3000` would read `--port` as the
 * tunnel and `3000` as the project. A bare `flag`, or one followed by anything
 * but one of `values`, is rewritten in place to `flag=` (an empty value).
 */
export function normalizeOptionalValueFlag(rawArgs: string[], flag: string, values: readonly string[]): void {
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]
    if (arg === '--') {
      return
    }
    if (arg !== flag) {
      continue
    }
    const next = rawArgs[index + 1]
    if (next === undefined || !values.includes(next)) {
      rawArgs[index] = `${flag}=`
    }
  }
}
