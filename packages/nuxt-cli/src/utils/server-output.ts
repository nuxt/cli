import type { Nuxt } from '@nuxt/schema'
import type { Nitro, PrerenderRoute } from 'nitropack'

import { readdir, stat } from 'node:fs/promises'
import process from 'node:process'
import { styleText } from 'node:util'

import { join, relative } from 'pathe'

import { formatBytes, formatDuration } from './formatting'
import { logger } from './logger'

/** Nitro's `warn` level: warnings and errors still print, progress and file trees do not. */
const NITRO_QUIET_LOG_LEVEL = 1

export interface ServerOutputReport {
  /** The one-line summary of the server build, or nothing for a static-only build. */
  summary: () => string | undefined
}

/**
 * Take over what Nitro and the Vite server bundle print during `nuxt build`,
 * leaving warnings and errors in place, and report the server build as a single
 * line with its time and size once it is written.
 *
 * Nothing changes at `--log-level verbose`, or when the project sets a log
 * level for Nitro or the Vite server build itself.
 */
export function quietServerOutput(nuxt: Nuxt): ServerOutputReport {
  let started: number | undefined
  let duration: number | undefined
  let size: number | undefined
  let prerender: { count: number, duration: number } | undefined
  let commands: string[] = []
  let isStatic = false

  if (nuxt.options.logLevel !== 'verbose') {
    nuxt.hook('nitro:config', (config) => {
      if (nuxt.options.nitro?.logLevel === undefined && Number(config.logLevel ?? 3) > NITRO_QUIET_LOG_LEVEL) {
        config.logLevel = NITRO_QUIET_LOG_LEVEL
      }
    })
    // With the environment API one config builds client and server together, so
    // the server output cannot be quietened without the client's.
    const vite = nuxt.options.vite as { logLevel?: string, $server?: { logLevel?: string } } | undefined
    if (!nuxt.options.experimental?.viteEnvironmentApi && !vite?.logLevel && !vite?.$server?.logLevel) {
      nuxt.hook('vite:extendConfig', (config, { isServer }) => {
        // Read as well as written by Nuxt's Vite logger on every message, so it
        // has to change on this config rather than through a plugin.
        if (isServer && config.logLevel !== 'silent') {
          (config as { logLevel?: string }).logLevel = 'warn'
        }
      })
    }
  }

  let buildStarted = Date.now()
  nuxt.hook('nitro:build:before', () => {
    buildStarted = Date.now()
  })

  nuxt.hook('nitro:init', (nitro) => {
    let prerendered = 0
    nitro.hooks.hook('prerender:route', (route) => {
      if (!route.error) {
        prerendered++
      }
    })
    nitro.hooks.hook('prerender:done', ({ failedRoutes }) => {
      prerender = { count: prerendered, duration: Date.now() - buildStarted }
      // Nitro lists these at its `log` level, which the quiet build drops.
      if (failedRoutes.length && nuxt.options.logLevel !== 'verbose') {
        logger.error(`Failed to prerender ${failedRoutes.length} route${failedRoutes.length === 1 ? '' : 's'}:\n${
          failedRoutes.map(formatFailedRoute).join('\n')}`)
      }
    })
    nitro.hooks.hook('rollup:before', () => {
      started ??= Date.now()
    })
    nitro.hooks.hook('compiled', async () => {
      isStatic = !!nitro.options.static
      duration = Date.now() - (started ?? buildStarted)
      size = await directorySize(nitro.options.output.serverDir).catch(() => undefined)
      commands = ([
        ['Preview', nitro.options.commands?.preview],
        ['Deploy', nitro.options.commands?.deploy],
      ] as const).flatMap(([label, command]) => command ? [`${label}: ${styleText('cyan', resolveCommand(command, nitro))}`] : [])
    })
  })

  return {
    summary() {
      const lines: string[] = []
      if (prerender && prerender.count) {
        lines.push(`Prerendered ${prerender.count} route${prerender.count === 1 ? '' : 's'} in ${formatDuration(prerender.duration)}`)
      }
      if (!isStatic && duration !== undefined) {
        lines.push(`Server (nitro) built in ${formatDuration(duration)}${size === undefined ? '' : styleText('dim', ` \u00B7 ${formatBytes(size)}`)}`)
      }
      if (!lines.length) {
        return
      }
      return [...lines, ...commands.map(line => styleText('dim', line))].join('\n')
    },
  }
}

function formatFailedRoute(route: PrerenderRoute): string {
  const status = [route.error?.statusCode, route.error?.statusMessage].filter(Boolean).join(' ')
  return `  ${route.route}${status ? styleText('dim', ` (${status})`) : ''}`
}

/** Fill Nitro's `{{ output.dir }}` placeholders the way Nitro does, relative to the working directory. */
function resolveCommand(command: string, nitro: Nitro): string {
  return command.replace(/\{\{ ?([\w.]+) ?\}\}/g, (match, key: string) => {
    const value = key.split('.').reduce<any>((object, part) => object?.[part], nitro.options)
    return typeof value === 'string' ? relative(process.cwd(), value) || '.' : match
  })
}

/** Bytes on disk under `dir`, leaving out source maps as Nitro's own total does. */
async function directorySize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && !entry.name.endsWith('.map')) {
      total += (await stat(join(entry.parentPath, entry.name))).size
    }
  }
  return total
}
