import { existsSync } from 'node:fs'
import process from 'node:process'

import { delimiter, join, resolve } from 'pathe'

/**
 * Return a copy of `env` with `dirs` prepended to its `PATH`.
 *
 * On Windows the variable may be named `Path`, and adding a second `PATH` key
 * would leave the child with two conflicting entries, so the existing key is
 * reused when present.
 */
export function withPrependedPath(env: NodeJS.ProcessEnv, dirs: string[]): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env }
  const key = pathKey(result)
  const current = result[key]
  result[key] = [...dirs, ...(current ? [current] : [])].join(delimiter)
  return result
}

export function withLocalBinPath(cwd: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return withPrependedPath(env, [resolve(cwd, 'node_modules/.bin')])
}

function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find(name => name.toLowerCase() === 'path') ?? 'PATH'
}

/**
 * The path `name` resolves to on `env`'s `PATH`, or `undefined` if it is not there.
 *
 * Callers cannot rely on a failed spawn to tell them a command is missing: on
 * Windows a bare name is run through `cmd.exe`, which reports its own "not
 * recognized" error rather than `ENOENT`. Which extensions make a file executable
 * is a Windows concept, so `PATHEXT` is consulted there and nowhere else.
 */
export function findInPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']
  for (const dir of (env[pathKey(env)] || '').split(delimiter)) {
    if (!dir) {
      continue
    }
    for (const extension of extensions) {
      const candidate = join(dir, name + extension)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
}
