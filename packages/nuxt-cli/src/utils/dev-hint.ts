import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { dirname, join } from 'pathe'

import { debug } from './logger'

/**
 * The address the last `nuxt dev` run resolved from `nuxt.config` for a given
 * project, so the next run can bind a socket before loading the config.
 */
export interface DevServerHint {
  port?: number
  hostname?: string
  https?: boolean
  baseURL?: string
}

function hintPath(cwd: string): string {
  return join(cwd, 'node_modules/.cache/nuxt/dev-server.json')
}

export function loadDevServerHint(cwd: string): DevServerHint | undefined {
  try {
    const hint = JSON.parse(readFileSync(hintPath(cwd), 'utf-8')) as DevServerHint
    return typeof hint === 'object' && hint ? hint : undefined
  }
  catch {
    return undefined
  }
}

/** Persist the resolved address. Never throws: the hint is only an optimisation. */
export function saveDevServerHint(cwd: string, hint: DevServerHint): void {
  const path = hintPath(cwd)
  // Writing outside an installed `node_modules` would create a directory tree
  // no tooling expects (and that nothing gitignores).
  if (!existsSync(join(cwd, 'node_modules'))) {
    return
  }
  try {
    if (JSON.stringify(loadDevServerHint(cwd)) === JSON.stringify(hint)) {
      return
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(hint), 'utf-8')
  }
  catch (error) {
    debug('Could not persist dev server hint:', error)
  }
}
