import process from 'node:process'
import { delimiter, resolve } from 'pathe'

/**
 * Return a copy of `env` with `dirs` prepended to its `PATH`.
 *
 * On Windows the variable may be named `Path`, and adding a second `PATH` key
 * would leave the child with two conflicting entries, so the existing key is
 * reused when present.
 */
export function withPrependedPath(env: NodeJS.ProcessEnv, dirs: string[]): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env }
  const key = Object.keys(result).find(name => name.toLowerCase() === 'path') ?? 'PATH'
  const current = result[key]
  result[key] = [...dirs, ...(current ? [current] : [])].join(delimiter)
  return result
}

export function withLocalBinPath(cwd: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return withPrependedPath(env, [resolve(cwd, 'node_modules/.bin')])
}
