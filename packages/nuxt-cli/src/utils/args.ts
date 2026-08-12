import { resolve } from 'pathe'

function cwdArgIndex(rawArgs: string[]): number {
  const end = rawArgs.indexOf('--')
  const index = rawArgs.findIndex(arg => arg === '--cwd' || arg.startsWith('--cwd='))
  return end !== -1 && index > end ? -1 : index
}

/**
 * Commands accept `--cwd` as an undeclared alias for their ROOTDIR positional, so it stays out
 * of `--help`. Undeclared, only the `--cwd=<dir>` form is safe: mri treats a bare `--cwd` as
 * boolean and its value would be consumed as a positional. Rewrite to that form, keeping the
 * last occurrence, and move it after a command name that citty would otherwise slice the
 * preceding arguments off, but ahead of any `--` separator so it is still parsed as a flag.
 * @see https://github.com/nuxt/cli/issues/365
 */
export function normaliseCwdArg(rawArgs: string[]): void {
  let cwd: string | undefined
  for (let index = cwdArgIndex(rawArgs); index !== -1; index = cwdArgIndex(rawArgs)) {
    const arg = rawArgs[index]!
    const inline = arg.includes('=')
    const [, value] = rawArgs.splice(index, inline ? 1 : 2)
    cwd = inline ? arg.slice(arg.indexOf('=') + 1) : value
  }

  if (cwd === undefined) {
    return
  }

  const separator = rawArgs.indexOf('--')
  rawArgs.splice(separator === -1 ? rawArgs.length : separator, 0, `--cwd=${cwd}`)
}

/**
 * Point already-normalised `rawArgs` at `cwd`, so a process launched with them
 * (a dev fork) runs against the same directory as this one.
 *
 * A positional resolving to `previousCwd` is dropped along with any existing
 * `--cwd`: it named the directory being moved away from, and leaving it would
 * disagree with the directory being moved to.
 */
export function replaceCwdArg(rawArgs: string[], cwd: string, previousCwd: string): void {
  const separator = rawArgs.indexOf('--')
  const end = separator === -1 ? rawArgs.length : separator

  for (let index = end - 1; index >= 0; index--) {
    const arg = rawArgs[index]!
    if (arg.startsWith('--cwd=') || (!arg.startsWith('-') && resolve(arg) === previousCwd)) {
      rawArgs.splice(index, 1)
    }
  }

  const remaining = rawArgs.indexOf('--')
  rawArgs.splice(remaining === -1 ? rawArgs.length : remaining, 0, `--cwd=${cwd}`)
}
