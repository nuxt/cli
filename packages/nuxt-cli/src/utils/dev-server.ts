import { styleText } from 'node:util'
import { resolve } from 'pathe'

import { readActiveLock } from './lockfile'
import { getNuxtConfig } from './nuxt-config'

const TRAILING_SLASH_RE = /\/$/

export interface RunningDevServer {
  /** Origin the dev server is listening on, without a trailing slash. */
  url: string
  pid: number
  cwd: string
}

/**
 * Locate a live `nuxt dev` server for a project, using the metadata its dev
 * server records in `nuxt.lock` inside the build directory.
 *
 * `buildDir` may be passed when it is already known; otherwise the default
 * `.nuxt` is tried before falling back to reading `nuxt.config`.
 */
export async function findDevServer(cwd: string, buildDir?: string): Promise<RunningDevServer | undefined> {
  const candidates = buildDir
    ? [resolve(cwd, buildDir)]
    : [resolve(cwd, '.nuxt'), await configuredBuildDir(cwd)]

  const seen = new Set<string>()
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) {
      continue
    }
    seen.add(dir)

    const lock = readActiveLock(dir)
    if (lock?.command === 'dev' && lock.url) {
      return { url: lock.url.replace(TRAILING_SLASH_RE, ''), pid: lock.pid, cwd: lock.cwd }
    }
  }
}

export function noDevServerMessage(what: string): string {
  return `No running Nuxt dev server found. Start one with ${styleText('cyan', 'nuxt dev')}, or pass an absolute URL to ${styleText('cyan', what)}.`
}

async function configuredBuildDir(cwd: string): Promise<string | undefined> {
  try {
    const config = await getNuxtConfig(cwd)
    return config.buildDir ? resolve(cwd, config.buildDir) : undefined
  }
  catch {
    return undefined
  }
}
