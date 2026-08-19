import { resolve } from 'pathe'

/**
 * Point `rawArgs` at `cwd`, so a process launched with them (a dev fork) runs
 * against the same directory as this one.
 *
 * A positional resolving to `previousCwd` is dropped along with any existing
 * `--cwd`: it named the directory being moved away from, and leaving it would
 * disagree with the directory being moved to.
 */
export function replaceCwdArg(rawArgs: string[], cwd: string, previousCwd: string): void {
  const separator = rawArgs.indexOf('--')
  const end = separator === -1 ? rawArgs.length : separator

  const kept: string[] = []
  for (let index = 0; index < end; index++) {
    const arg = rawArgs[index]!
    if (arg === '--cwd') {
      index++
      continue
    }
    if (arg.startsWith('--cwd=') || (!arg.startsWith('-') && resolve(arg) === previousCwd)) {
      continue
    }
    kept.push(arg)
  }

  rawArgs.splice(0, end, ...kept, `--cwd=${cwd}`)
}
