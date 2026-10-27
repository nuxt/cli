import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { dirname, join } from 'pathe'

import { debug } from './logger'

/**
 * The address the last `nuxt dev` run resolved from `nuxt.config` for a given
 * project, so the next run can bind a socket before loading the config, and
 * the `allowedHosts` (`devServer` and `vite.server` combined) that socket
 * accepts until the config loads.
 */
export interface DevServerHint {
  port?: number
  hostname?: string
  https?: boolean
  baseURL?: string
  allowedHosts?: true | string[]
}

function hintPath(cwd: string): string {
  return join(cwd, 'node_modules/.cache/nuxt/dev-server.json')
}

/**
 * Keep only fields of the expected type. The hint is written by this CLI but
 * also read and written by other versions, so it cannot be trusted to match.
 */
function sanitizeDevServerHint(value: unknown): DevServerHint {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const source = value as Record<string, unknown>
  const hint: DevServerHint = {}
  if (typeof source.port === 'number') {
    hint.port = source.port
  }
  if (typeof source.hostname === 'string') {
    hint.hostname = source.hostname
  }
  if (typeof source.https === 'boolean') {
    hint.https = source.https
  }
  if (typeof source.baseURL === 'string') {
    hint.baseURL = source.baseURL
  }
  if (source.allowedHosts === true) {
    hint.allowedHosts = true
  }
  else if (Array.isArray(source.allowedHosts)) {
    hint.allowedHosts = source.allowedHosts.filter((host): host is string => typeof host === 'string')
  }
  return hint
}

export function loadDevServerHint(cwd: string): DevServerHint | undefined {
  try {
    const hint = JSON.parse(readFileSync(hintPath(cwd), 'utf-8'))
    return typeof hint === 'object' && hint && !Array.isArray(hint) ? sanitizeDevServerHint(hint) : undefined
  }
  catch {
    return undefined
  }
}

/** Persist the resolved address. Never throws: the hint is only an optimisation. */
export function saveDevServerHint(cwd: string, hint: DevServerHint): void {
  const sanitized = sanitizeDevServerHint(hint)
  const path = hintPath(cwd)
  // Writing outside an installed `node_modules` would create a directory tree
  // no tooling expects (and that nothing gitignores).
  if (!existsSync(join(cwd, 'node_modules'))) {
    return
  }
  try {
    if (JSON.stringify(loadDevServerHint(cwd)) === JSON.stringify(sanitized)) {
      return
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(sanitized), 'utf-8')
  }
  catch (error) {
    debug('Could not persist dev server hint:', error)
  }
}
