import type * as OpenTunnelSDK from '@opentunnel/client'

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { resolveModulePath } from 'exsolve'
import { dirname, join } from 'pathe'
import { satisfies } from 'verkit'

import { debug, logger } from '../../utils/logger'

/**
 * The OpenTunnel SDK is not a dependency of the CLI: with `effect` it is most of
 * a megabyte, which nobody who never runs `--tunnel=opentunnel` should install.
 * It is resolved from the project instead, and installed there as a dev
 * dependency the first time it is needed (see `ensureOpenTunnelSDK`).
 */
export const OPENTUNNEL_SDK = '@opentunnel/client'

/** The SDK releases this CLI works with. A `0.x` minor may break its API. */
export const OPENTUNNEL_SDK_RANGE = '^0.4.0'

/** Required peers, installed with the SDK as `nuxt module add` does for modules. */
export const OPENTUNNEL_SDK_PEERS: Readonly<Record<string, string>> = { effect: '^4.0.0' }

export interface ResolvedPackage {
  version: string
  /** The module `import` resolves to. */
  entry: string
}

/**
 * The copy of `name` that `rootDir` resolves, found through its main entry
 * rather than `<name>/package.json`, which a package may not export.
 */
export function resolveProjectPackage(name: string, rootDir: string): ResolvedPackage | undefined {
  // Uncached: the answer changes once `ensureOpenTunnelSDK` has installed it.
  const entry = resolveModulePath(name, { from: join(rootDir, '/'), try: true, cache: false })
  if (!entry) {
    return undefined
  }
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string, version?: string }
      if (manifest.name === name) {
        return { version: manifest.version ?? '', entry }
      }
    }
    catch {
      // no manifest at this level
    }
  }
  debug(`Could not find the package.json of ${name} above ${entry}.`)
  return undefined
}

export type OpenTunnelSDKState
  = | { status: 'installed', version: string, entry: string }
    | { status: 'incompatible', version: string }
    | { status: 'missing' }

/** Whether the project in `rootDir` has a usable copy of the SDK. */
export function findOpenTunnelSDK(rootDir: string): OpenTunnelSDKState {
  const sdk = resolveProjectPackage(OPENTUNNEL_SDK, rootDir)
  if (!sdk) {
    return { status: 'missing' }
  }
  return satisfies(sdk.version, OPENTUNNEL_SDK_RANGE)
    ? { status: 'installed', ...sdk }
    : { status: 'incompatible', version: sdk.version }
}

/**
 * Import the SDK installed in the project. Returns `undefined`, with a warning,
 * when it is missing or outside {@link OPENTUNNEL_SDK_RANGE}.
 */
export async function loadOpenTunnelSDK(rootDir: string): Promise<typeof OpenTunnelSDK | undefined> {
  const state = findOpenTunnelSDK(rootDir)
  if (state.status !== 'installed') {
    const found = state.status === 'incompatible' ? ` (found ${state.version})` : ''
    logger.warn(`\`--tunnel=opentunnel\` needs \`${OPENTUNNEL_SDK}@${OPENTUNNEL_SDK_RANGE}\` in your project${found}.`)
    return undefined
  }
  try {
    return await import(pathToFileURL(state.entry).href) as typeof OpenTunnelSDK
  }
  catch (error) {
    debug(`Failed to load ${state.entry}:`, error)
    logger.warn(`Could not load \`${OPENTUNNEL_SDK}@${state.version}\` from your project.`)
    return undefined
  }
}
