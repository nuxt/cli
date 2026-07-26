import { delimiter, relative } from 'node:path'
import process from 'node:process'
import { link } from 'clickable-path'
import { resolve } from 'pathe'

import { logger } from './logger'

const cwd = process.cwd()

/**
 * Resolve the root directory a command should operate in from its `rootDir` positional
 * and optional `--cwd` override, warning when the two disagree.
 */
export function resolveRootDir(args: { cwd?: string, rootDir?: string }): string {
  // citty fills positionals from mri's `_`, which also collects arguments following `--`, so
  // `nuxt test -- --watch` would otherwise resolve a directory named after a passthrough flag
  const rootDir = args.rootDir?.startsWith('-') ? undefined : args.rootDir

  if (!args.cwd) {
    return resolve(rootDir || '.')
  }

  const resolved = resolve(args.cwd)
  if (rootDir && resolve(rootDir) !== resolved) {
    logger.warn(`Both \`--cwd\` and \`ROOTDIR\` were provided; using \`${relativeToProcess(resolved)}\`.`)
  }

  return resolved
}

export function relativeToProcess(path: string) {
  return link(path, {
    cwd,
    formatter: absolute => relative(cwd, absolute) || absolute,
  })
}

export function withNodePath(path: string) {
  return [path, ...(process.env.NODE_PATH?.split(delimiter) || [])]
}
