import type { TunnelOptions, TunnelProvider } from './types'

import { createHash, randomBytes } from 'node:crypto'

import { isCancel, select } from '@clack/prompts'
import { resolve } from 'pathe'
import { readUser, updateUser } from 'rc9'

import { restoreRawMode, withDirectStdout } from '../../utils/console'
import { debug, logger } from '../../utils/logger'
import { withUserAttention } from '../../utils/startup-clock'
import { isInteractive } from '../../utils/stdout'

/**
 * Kept in the user `.nuxtrc` under `tools`, like the other CLI-owned settings:
 * Nuxt also reads that file as config (`globalRc`), and `tools` keeps these
 * keys out of the way of anything a project configures.
 */
const RC_FILE = '.nuxtrc'
const SEED_RE = /^[0-9a-f]{32}$/

interface TunnelRC {
  tools?: {
    tunnel?: { provider?: unknown }
    opentunnel?: { seed?: unknown }
  }
}

/** Normalize a supported provider or its `cloudflared` alias, returning `undefined` for unknown values. */
export function parseTunnelProvider(value: unknown): TunnelProvider | undefined {
  if (value === 'cloudflare' || value === 'cloudflared') {
    return 'cloudflare'
  }
  if (value === 'opentunnel') {
    return 'opentunnel'
  }
  return undefined
}

/**
 * Resolve `--tunnel` into the provider to start, prompting (once) when it is
 * passed without a value. Must run before the dev server takes the terminal.
 */
export async function resolveTunnelOptions(flag: string | boolean | undefined, rootDir: string): Promise<TunnelOptions | undefined> {
  if (flag === undefined || flag === false) {
    return undefined
  }
  const provider = await resolveTunnelProvider(flag)
  if (provider === 'opentunnel') {
    // The SDK lives in the project, and installing it may prompt. Imported on
    // demand, as it pulls in the package manager helpers.
    const { ensureOpenTunnelSDK } = await import('./opentunnel-install')
    if (!await ensureOpenTunnelSDK(rootDir)) {
      return undefined
    }
    return { provider, route: deriveRouteName(resolveSeed(), rootDir), rootDir }
  }
  return provider ? { provider } : undefined
}

/**
 * Use an explicit or saved provider, otherwise prompt and save the choice.
 * Fall back to Cloudflare for unknown values or a non-interactive first run;
 * return `undefined` when the prompt is cancelled.
 */
async function resolveTunnelProvider(flag: string | true): Promise<TunnelProvider | undefined> {
  if (flag !== true && flag !== '') {
    const provider = parseTunnelProvider(flag)
    if (provider) {
      return provider
    }
    logger.warn(`Unknown tunnel provider \`${flag}\`: use \`--tunnel=cloudflare\` or \`--tunnel=opentunnel\`. Using a Cloudflare quick tunnel.`)
    return 'cloudflare'
  }

  const saved = parseTunnelProvider(readRC().tools?.tunnel?.provider)
  if (saved) {
    return saved
  }

  // Nothing is saved, so the question is still asked once a terminal is there.
  if (!isInteractive()) {
    return 'cloudflare'
  }

  const choice = await withUserAttention(() => withDirectStdout(() => select<TunnelProvider>({
    message: 'Which tunnel do you want to use?',
    options: [
      { value: 'cloudflare', label: 'Cloudflare quick tunnel', hint: 'a new URL on each run, downloads cloudflared' },
      { value: 'opentunnel', label: 'OpenTunnel', hint: 'the same URL on each run, end-to-end encrypted' },
    ],
  })))
  restoreRawMode()
  if (isCancel(choice)) {
    logger.info('No tunnel selected. Starting without a tunnel.')
    return undefined
  }

  if (writeRC({ tools: { tunnel: { provider: choice } } })) {
    logger.info(`Saved \`${choice}\` as your tunnel provider in \`~/${RC_FILE}\`. Pass \`--tunnel=<provider>\` to use another one.`)
  }
  return choice
}

/**
 * A route name that is stable for a project but cannot be guessed from its
 * path: route names never appear in certificate transparency logs, so this is
 * what keeps the URL private. It is a lowercase DNS label, as routes must be.
 */
export function deriveRouteName(seed: string, rootDir: string): string {
  return createHash('sha256').update(`${seed}\0${resolve(rootDir)}`).digest('hex').slice(0, 16)
}

/** Reuse a valid saved seed or generate one, attempting to persist it for stable project URLs. */
function resolveSeed(): string {
  const saved = readRC().tools?.opentunnel?.seed
  if (typeof saved === 'string' && SEED_RE.test(saved)) {
    return saved
  }
  const seed = randomBytes(16).toString('hex')
  // Without a saved seed the URL still works, but changes on the next run.
  writeRC({ tools: { opentunnel: { seed } } })
  return seed
}

/** Read the user tunnel settings, returning an empty object if reading fails. */
function readRC(): TunnelRC {
  try {
    return readUser(RC_FILE) as TunnelRC
  }
  catch (error) {
    debug(`Failed to read user ${RC_FILE}:`, error)
    return {}
  }
}

/** Merge tunnel settings into the user `.nuxtrc`, returning whether the update succeeded. */
function writeRC(config: TunnelRC): boolean {
  try {
    updateUser(config, RC_FILE)
    return true
  }
  catch (error) {
    debug(`Failed to update user ${RC_FILE}:`, error)
    return false
  }
}
