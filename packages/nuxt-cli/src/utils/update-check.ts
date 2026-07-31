import process from 'node:process'

import { styleText } from 'node:util'
import { S_INFO } from '@clack/prompts'
import { readUser, updateUser } from 'rc9'
import { isCI, isTest, provider } from 'std-env'
import { joinURL } from 'ufo'
import { isGreater, tryParse } from 'verkit'

import { fetchJson } from './fetch'
import { debug } from './logger'
import { detectNpmRegistry } from './registry'
import { blankLineBefore, trackOutputSpacing } from './stdout'

const RC_FILE = '.nuxtrc'
const CACHE_KEY = 'updateCheck'
const CACHE_TTL = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = 3000

/**
 * Patch releases within the same minor are only worth interrupting for once the
 * user is meaningfully behind; a single patch is noise for anyone who upgrades
 * regularly.
 */
const MIN_PATCH_DISTANCE = 5

export interface NuxtUpdate {
  current: string
  latest: string
}

interface PackageCache {
  latest?: string
  checkedAt?: number
}

interface UpdateCache extends PackageCache {
  enabled?: boolean
  /** Keyed by package name; `nuxt` lives at the top level for backwards compatibility. */
  packages?: Record<string, PackageCache>
}

function readCache(): UpdateCache {
  try {
    return (readUser(RC_FILE)[CACHE_KEY] as UpdateCache | undefined) || {}
  }
  catch (error) {
    debug('Failed to read update check cache:', error)
    return {}
  }
}

function writeCache(cache: UpdateCache) {
  try {
    updateUser({ [CACHE_KEY]: cache }, RC_FILE)
  }
  catch (error) {
    debug('Failed to persist update check cache:', error)
  }
}

/**
 * `NUXT_IGNORE_UPDATE_CHECK=1` (or the cross-tool `NO_UPDATE_NOTIFIER`) opts out
 * for a single run and `updateCheck.enabled=false` in the user `.nuxtrc` opts
 * out permanently. We also stay quiet where the nudge cannot be acted on
 * interactively (CI, tests, StackBlitz, no TTY).
 */
export function isUpdateCheckEnabled(): boolean {
  if (process.env.NUXT_IGNORE_UPDATE_CHECK || process.env.NO_UPDATE_NOTIFIER) {
    return false
  }
  if (readCache().enabled === false) {
    return false
  }
  return !isCI && !isTest && provider !== 'stackblitz' && Boolean(process.stdout.isTTY)
}

async function resolveLatestVersion(name: string): Promise<string | undefined> {
  const cache = readCache()
  const entry = name === 'nuxt' ? cache : cache.packages?.[name] || {}
  if (entry.checkedAt && Date.now() - Number(entry.checkedAt) < CACHE_TTL) {
    return entry.latest
  }

  let latest: string | undefined
  try {
    const { registry, authToken } = await detectNpmRegistry(null)
    latest = (await fetchJson<{ latest?: string }>(joinURL(registry, `-/package/${name}/dist-tags`), {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      timeout: FETCH_TIMEOUT,
      retry: 0,
    })).latest
  }
  catch (error) {
    debug(`Failed to resolve the latest ${name} version:`, error)
  }

  // an unreachable or unauthenticated registry is recorded as a completed check
  // so an offline user does not pay the request timeout on every command
  const checked = { latest, checkedAt: Date.now() }
  writeCache(name === 'nuxt' ? checked : { packages: { [name]: checked } })
  return latest
}

/**
 * Compare an installed version against the registry's `latest`, returning
 * nothing when there is no nudge worth showing.
 */
export async function checkForUpdate(name: string, current: string | undefined): Promise<NuxtUpdate | undefined> {
  const latest = await resolveLatestVersion(name)
  if (!current || !latest) {
    return undefined
  }

  const installed = tryParse(current)
  const published = tryParse(latest)
  if (!installed || !published) {
    return undefined
  }

  // prereleases are compared against `latest`, which is never the right
  // baseline for someone tracking nightlies or release candidates
  if (installed.prerelease) {
    return undefined
  }

  if (!isGreater(latest, current)) {
    return undefined
  }

  if (
    published.major === installed.major
    && published.minor === installed.minor
    && published.patch - installed.patch < MIN_PATCH_DISTANCE
  ) {
    return undefined
  }

  return { current, latest }
}

export interface UpdateNudgeOptions {
  /** Display name of the package, e.g. `Nuxt`. */
  name?: string
  /** Command that gets the user onto the new version. */
  command?: string
}

/**
 * Both nudges are written as a labelled line plus an indented instruction, so
 * whatever the user needs to type is on a line of its own that they can select.
 *
 * Commands leave the cursor in different places (`init` ends on the blank line
 * after clack's outro, `dev` and `build` on the line after their last log), so
 * the leading gap is measured rather than assumed.
 */
function writeNudge(headline: string, instruction: string): void {
  process.stdout.write(`${blankLineBefore()}${styleText('blue', S_INFO)} ${headline}\n  ${instruction}\n`)
}

function describeUpdate({ current, latest }: NuxtUpdate, name: string): string {
  return `a new version of ${name} is available: ${styleText('green', latest)} ${styleText('gray', `(you are on ${current})`)}`
}

export function renderUpdateNudge(update: NuxtUpdate, options: UpdateNudgeOptions = {}): void {
  const { name = 'Nuxt', command = 'nuxt upgrade' } = options
  writeNudge(describeUpdate(update, name), `run ${styleText('cyan', command)} to update`)
}

/**
 * A nudge for a stale scaffolder, where the user has already got what they came
 * for and only needs to know what to type next time.
 */
export function renderSelfUpdateNudge(update: NuxtUpdate, options: UpdateNudgeOptions = {}): void {
  const { name = 'the Nuxt CLI', command = 'nuxt upgrade' } = options
  writeNudge(describeUpdate(update, name), `next time, run ${styleText('cyan', command)} to use the latest version`)
}

export interface SelfUpdateNudgeOptions extends UpdateNudgeOptions {
  /**
   * Last word on whether to nudge, called only once a newer version is found so
   * an expensive check is not paid for by an up-to-date user.
   */
  shouldNudge?: () => boolean
}

/**
 * Nudge about a stale version of the CLI package itself. Unlike a project
 * dependency there is nothing to upgrade in place: the user re-runs the
 * published package, so `command` should point at that invocation.
 */
export async function scheduleSelfUpdateNudge(name: string, current: string, options: SelfUpdateNudgeOptions): Promise<void> {
  if (!isUpdateCheckEnabled()) {
    return
  }

  const update = await checkForUpdate(name, current).catch((error) => {
    debug(`Failed to check for ${name} updates:`, error)
    return undefined
  })

  if (update && (options.shouldNudge?.() ?? true)) {
    deferNudge(update, options, renderSelfUpdateNudge)
  }
}

export function deferNudge(update: NuxtUpdate, options?: UpdateNudgeOptions, render = renderUpdateNudge) {
  trackOutputSpacing()
  process.once('exit', () => {
    try {
      render(update, options)
    }
    catch (error) {
      debug('Failed to render update nudge:', error)
    }
  })
}
