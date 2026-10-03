import type { NuxtConfig } from '@nuxt/schema'

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { resolveModulePath } from 'exsolve'
import { join } from 'pathe'

import { debug } from '../utils/logger'
import { INSPECT_ENV } from './inspect'

/**
 * Nitro plugin that attributes the app's logs to the request that caused them,
 * from inside the module runner's realm. Resolved through this package's own
 * exports because the caller may be bundled into any chunk.
 */
function registerRequestContextPlugin(nitro: NitroConfigForHook, cwd: string): void {
  try {
    const source = fileURLToPath(import.meta.resolve('@nuxt/cli/runtime/dev-request-context'))
    const id = join(nitro.buildDir || join(cwd, '.nuxt'), 'dev-request-context.mjs')
    // The build dir is not a package, so `consola` is pinned to the copy the app
    // itself logs through; a bare specifier would not resolve from there.
    const consola = resolveConsola(cwd)
    nitro.virtual ||= {}
    nitro.virtual[id] = () => readFileSync(source, 'utf8').replace('\'consola\'', JSON.stringify(consola))
    nitro.plugins ||= []
    nitro.plugins.push(id)
  }
  catch (error) {
    debug('Could not resolve the request context plugin; app logs will not be attributed:', error)
  }
}

function registerRuntimePlugin(nitro: NitroConfigForHook, name: 'dev-close-sockets' | 'dev-inspector'): void {
  try {
    nitro.plugins ||= []
    nitro.plugins.push(fileURLToPath(import.meta.resolve(`@nuxt/cli/runtime/${name}`)))
  }
  catch (error) {
    debug(`Could not resolve the ${name} plugin:`, error)
  }
}

/**
 * The `consola` the app itself logs through, which is the one
 * `@nuxt/nitro-server` wraps `console` with: its own, not the CLI's. Reporting
 * from any other instance sees none of the app's logs.
 */
function resolveConsola(cwd: string): string {
  const nuxt = resolveModulePath('nuxt', { from: cwd, try: true })
  const from = [nuxt, cwd].filter(Boolean) as string[]
  return resolveModulePath('consola', { from, try: true }) ?? fileURLToPath(import.meta.resolve('consola'))
}

type NitroConfigForHook = Parameters<NonNullable<NonNullable<NuxtConfig['hooks']>['nitro:config']>>[0]

/** Add the CLI's runtime plugins to the Nitro dev server's config. */
export function registerDevPlugins(nitro: NitroConfigForHook, cwd: string, attributeRequests?: boolean): void {
  registerRuntimePlugin(nitro, 'dev-close-sockets')
  if (process.env[INSPECT_ENV]) {
    registerRuntimePlugin(nitro, 'dev-inspector')
  }
  if (attributeRequests) {
    registerRequestContextPlugin(nitro, cwd)
  }
}
