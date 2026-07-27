import { existsSync, readFileSync } from 'node:fs'
import { styleText } from 'node:util'

import { join, resolve } from 'pathe'

import { isProcessAlive, readActiveLock, readLock } from './lockfile'
import { getNuxtConfig } from './nuxt-config'

const TRAILING_SLASH_RE = /\/$/

/** Loopback address to dial for each wildcard a listener can be bound to. */
const LOOPBACK_FOR_WILDCARD: Record<string, string> = {
  '0.0.0.0': '127.0.0.1',
  '[::]': '[::1]',
}

export interface RunningDevServer {
  /** Origin the dev server is listening on, without a trailing slash. */
  url: string
  pid: number
  cwd: string
}

/**
 * Directory a project's `nuxt.lock` lives in.
 *
 * `.nuxt` answers this for nearly every project, so `nuxt.config` is only
 * evaluated when that directory is absent: resolving `buildDir` properly means
 * executing the user's config, and `nuxt dev` does not otherwise do that in the
 * process that decides whether to take a running server over. A project that
 * moved its `buildDir` but kept a stale `.nuxt` therefore reads as the default,
 * which loses the takeover but never claims a directory that is in use.
 */
export async function resolveLockDir(cwd: string): Promise<string> {
  const defaultDir = resolve(cwd, '.nuxt')
  if (readLock(defaultDir) || existsSync(defaultDir)) {
    return defaultDir
  }

  const configured = await configuredBuildDir(cwd)
  return configured || defaultDir
}

/**
 * Locate a live `nuxt dev` server for a project, using the metadata its dev
 * server records in `nuxt.lock` inside the build directory.
 *
 * `buildDir` may be passed when it is already known.
 */
export async function findDevServer(cwd: string, buildDir?: string): Promise<RunningDevServer | undefined> {
  const dir = buildDir ? resolve(cwd, buildDir) : await resolveLockDir(cwd)

  const lock = readActiveLock(dir)
  if (lock?.command === 'dev' && lock.url) {
    return { url: toLoopback(lock.url), pid: lock.pid, cwd: lock.cwd }
  }
}

/**
 * A dev server bound to every interface records the wildcard it was given, but
 * that is not an address to connect to: Windows refuses `0.0.0.0` outright, and
 * Nitro only serves its dev-only routes (the task runner, the VFS viewer) to
 * requests arriving on the loopback interface.
 */
export function toLoopback(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return url.replace(TRAILING_SLASH_RE, '')
  }

  const loopback = LOOPBACK_FOR_WILDCARD[parsed.hostname]
  if (loopback) {
    parsed.hostname = loopback
  }

  return parsed.href.replace(TRAILING_SLASH_RE, '')
}

export interface NitroDevWorker {
  pid: number
  /** Socket the worker listens on, when it was given one. */
  socketPath?: string
  /** Origin the worker listens on, when it was given a port instead. */
  url?: string
}

/**
 * Locate the Nitro dev worker behind a dev server, from the build info Nitro
 * writes for its own task runner.
 *
 * The worker answers the dev-only routes directly, so reaching it needs neither
 * the public listener nor the dev proxy in front of it. Nitro 2 records this in
 * `<buildDir>/nitro.json` and Nitro 3 in `node_modules/.nitro/nitro.dev.json`;
 * both are internal to Nitro, so everything here is best-effort.
 */
export async function findNitroDevWorker(cwd: string, buildDir?: string): Promise<NitroDevWorker | undefined> {
  const dir = buildDir ? resolve(cwd, buildDir) : await resolveLockDir(cwd)

  for (const path of [join(dir, 'nitro.json'), join(cwd, 'node_modules/.nitro/nitro.dev.json')]) {
    const dev = readBuildInfo(path)?.dev
    if (!dev?.pid || !dev.workerAddress || !isProcessAlive(dev.pid)) {
      continue
    }

    const { socketPath, host, port } = dev.workerAddress
    if (socketPath) {
      return { pid: dev.pid, socketPath }
    }
    if (port) {
      return { pid: dev.pid, url: `http://${host || 'localhost'}:${port}` }
    }
  }
}

export function noDevServerMessage(what: string): string {
  return `No running Nuxt dev server found. Start one with ${styleText('cyan', 'nuxt dev')}, or pass an absolute URL to ${styleText('cyan', what)}.`
}

interface NitroBuildInfo {
  dev?: {
    pid?: number
    workerAddress?: { socketPath?: string, host?: string, port?: number }
  }
}

function readBuildInfo(path: string): NitroBuildInfo | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as NitroBuildInfo
  }
  catch {
    return undefined
  }
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
