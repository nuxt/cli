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
  if (!args.cwd) {
    return resolve(args.rootDir || '.')
  }

  const resolved = resolve(args.cwd)
  if (args.rootDir && resolve(args.rootDir) !== resolved) {
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
