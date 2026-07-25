import process from 'node:process'

import { box } from '@clack/prompts'
import { $fetch } from 'ofetch'
import colors from 'picocolors'
import { readUser, updateUser } from 'rc9'
import { isCI, isTest, provider } from 'std-env'
import { joinURL } from 'ufo'
import { isGreater, tryParse } from 'verkit'

import { debug } from './logger'
import { detectNpmRegistry } from './registry'

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

interface UpdateCache {
  enabled?: boolean
  latest?: string
  checkedAt?: number
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

async function resolveLatestVersion(): Promise<string | undefined> {
  const cache = readCache()
  if (cache.checkedAt && Date.now() - Number(cache.checkedAt) < CACHE_TTL) {
    return cache.latest
  }

  let latest: string | undefined
  try {
    const { registry, authToken } = await detectNpmRegistry(null)
    latest = (await $fetch<{ latest?: string }>(joinURL(registry, '-/package/nuxt/dist-tags'), {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      timeout: FETCH_TIMEOUT,
      retry: 0,
    })).latest
  }
  catch (error) {
    debug('Failed to resolve the latest Nuxt version:', error)
  }

  // an unreachable or unauthenticated registry is recorded as a completed check
  // so an offline user does not pay the request timeout on every command
  writeCache({ latest, checkedAt: Date.now() })
  return latest
}

/**
 * Resolve the installed and latest Nuxt versions, returning nothing when the
 * project is already current or when anything at all goes wrong (an offline
 * user should never see an error from a check they did not ask for).
 */
export async function checkForNuxtUpdate(cwd: string): Promise<NuxtUpdate | undefined> {
  try {
    // imported lazily to keep package resolution off the CLI startup path
    const [current, latest] = await Promise.all([
      import('./versions').then(({ getNuxtVersion }) => getNuxtVersion(cwd)).catch(() => undefined),
      resolveLatestVersion(),
    ])

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
  catch (error) {
    debug('Failed to check for Nuxt updates:', error)
    return undefined
  }
}

export function renderUpdateNudge({ current, latest }: NuxtUpdate): void {
  const headline = `A new version of Nuxt is available: ${colors.green(latest)} ${colors.gray(`(you are on ${current})`)}`
  const action = `Run ${colors.cyan('nuxt upgrade')} to update.`

  process.stdout.write('\n')

  // `box` cannot lay itself out without a known terminal width
  const columns = process.stdout.columns
  if (!columns || columns < 60) {
    process.stdout.write(`${headline}\n${action}\n`)
    return
  }

  box(
    [
      headline,
      '',
      action,
    ].join('\n'),
    colors.green(' Update available '),
    {
      contentAlign: 'left',
      titleAlign: 'left',
      width: 'auto',
      titlePadding: 2,
      contentPadding: 2,
      rounded: true,
      withGuide: false,
    },
  )
}

/**
 * Check for a newer Nuxt release without blocking the command, deferring the
 * nudge to process exit so it can never interleave with the command's own
 * output (including the long-lived `dev` server's banner and logs).
 *
 * `upgrade` is excluded because the installed version is read when the command
 * starts, so a nudge would still be pending once the upgrade has succeeded.
 */
export async function scheduleUpdateNudge(cwd: string, command?: string): Promise<void> {
  if (command === 'upgrade' || !isUpdateCheckEnabled()) {
    return
  }

  const update = await checkForNuxtUpdate(cwd)
  if (!update) {
    return
  }

  process.once('exit', () => {
    try {
      renderUpdateNudge(update)
    }
    catch (error) {
      debug('Failed to render update nudge:', error)
    }
  })
}
