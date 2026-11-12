import type { Nuxt } from '@nuxt/schema'
import type { Nitro, PrerenderRoute } from 'nitropack'
import type { BuildEnvironment } from './build-progress'
import type { PhaseTiming } from './progress-snapshot'

import { readdir, stat } from 'node:fs/promises'
import process from 'node:process'
import { styleText } from 'node:util'

import { join, relative } from 'pathe'

import { formatBytes, formatDuration, stripAnsi } from './formatting'
import { logger } from './logger'

/** Nitro's `warn` level: warnings and errors still print, progress and file trees do not. */
const NITRO_QUIET_LOG_LEVEL = 1

const VITE_PLUGIN_NAME = 'nuxi:server-output'

/** The line Vite opens each environment's build with, e.g. `vite v8.3.5 building ssr environment for production...`. */
const ENVIRONMENT_BUILD_RE = /building (\S+) environment for/

/** Source maps, which `@nuxt/vite-server` writes as `*.map.json`. */
const SOURCE_MAP_RE = /\.map(?:\.json)?$/

export interface ServerOutputReport {
  /** The summary of the server build, from the build's phase timings, or nothing for a static-only build. */
  summary: (timings: PhaseTiming[]) => string | undefined
  /** How to preview and deploy what was built: no preview when no server was written. */
  commands: () => string[]
}

interface ServerOutputOptions {
  /** Called as each Vite environment starts building. */
  onEnvironment?: (environment: BuildEnvironment) => void
}

interface ViteLogger {
  info: (message: string, options?: unknown) => void
}

interface ResolvedViteConfig {
  logger: ViteLogger
  environments?: Record<string, { consumer?: string }>
}

interface ViteBuildContext {
  /** Absent before Vite 6, where each environment has a config of its own. */
  environment?: { name: string, config: { consumer?: string } }
}

/** Nuxt fields read optimistically: the server build descriptor only exists in recent Nuxt. */
interface MaybeServerBuild {
  serverBuild?: { name: string, output: { dir: () => string } }
}

/**
 * Take over what the server build prints during `nuxt build`, leaving warnings
 * and errors in place, and report it as a single line with its time and size
 * once it is written.
 *
 * Nitro 2 builds the server with its own bundler; Nitro 3 and `@nuxt/vite-server`
 * build it as a Vite environment, alongside the app. Either way the CLI keeps
 * Vite's file lists for the client only.
 *
 * Nothing changes at `--log-level verbose`, or when the project sets a log
 * level for Nitro or Vite itself.
 */
export function quietServerOutput(nuxt: Nuxt, options: ServerOutputOptions = {}): ServerOutputReport {
  const quiet = nuxt.options.logLevel !== 'verbose'
  let usesNitro = false
  let size: number | undefined
  let prerendered = 0
  let deploy: string | undefined
  let isStatic = false

  const measure = async (dir: string | undefined) => {
    size = dir ? await directorySize(dir).catch(() => undefined) : undefined
  }

  // Whether the CLI took Nitro's output over, and so owes what it hid.
  let nitroQuieted = false
  if (quiet) {
    nuxt.hook('nitro:config', (config) => {
      if (nuxt.options.nitro?.logLevel === undefined && Number(config.logLevel ?? 3) > NITRO_QUIET_LOG_LEVEL) {
        config.logLevel = NITRO_QUIET_LOG_LEVEL
        nitroQuieted = true
      }
    })
  }

  const vite = nuxt.options.vite as { logLevel?: string, $server?: { logLevel?: string } } | undefined
  const quietVite = quiet && !vite?.logLevel && !vite?.$server?.logLevel
  nuxt.hook('vite:extendConfig', (config, { isServer }) => {
    // A config of its own builds nothing but the server, so its log level can
    // drop too, which also silences the progress lines Vite's native reporter
    // writes straight to the terminal. With the environment API one config
    // builds every environment, and is read at hook time because a server
    // builder may switch the API on during setup.
    if (quietVite && isServer && !nuxt.options.experimental?.viteEnvironmentApi && config.logLevel !== 'silent') {
      (config as { logLevel?: string }).logLevel = 'warn'
    }
    // The environment API extends one shared config once per environment.
    const plugins = config.plugins as unknown[] | undefined
    if (plugins && !plugins.some(plugin => (plugin as { name?: string } | null)?.name === VITE_PLUGIN_NAME)) {
      plugins.push(createVitePlugin())
    }
  })

  function createVitePlugin() {
    const servers = new Set<string>()
    let muted = false
    let ssr = false
    return {
      name: VITE_PLUGIN_NAME,
      apply: 'build' as const,
      configResolved(config: ResolvedViteConfig & { build?: { ssr?: unknown } }) {
        ssr = !!config.build?.ssr
        for (const [name, environment] of Object.entries(config.environments ?? {})) {
          if (environment.consumer === 'server') {
            servers.add(name)
          }
        }
        if (!quietVite) {
          return
        }
        // Vite reports each environment through the one logger, at a single log
        // level. Muting its info messages while a server environment builds keeps
        // the client's file list and every warning.
        const info = config.logger.info.bind(config.logger)
        config.logger.info = (message, options) => {
          const environment = typeof message === 'string' ? stripAnsi(message).match(ENVIRONMENT_BUILD_RE)?.[1] : undefined
          if (environment) {
            muted = servers.has(environment)
          }
          if (!muted) {
            info(message, options)
          }
        }
      },
      buildStart(this: ViteBuildContext) {
        const consumer = this.environment?.config.consumer ?? (ssr ? 'server' : 'client')
        muted = consumer === 'server' && quietVite
        options.onEnvironment?.({ name: this.environment?.name, consumer })
      },
    }
  }

  // Without Nitro the Vite server build is the whole server output.
  nuxt.hook('build:done', async () => {
    if (!usesNitro) {
      const dir = (nuxt as unknown as MaybeServerBuild).serverBuild?.output.dir()
      await measure(dir ? join(dir, 'server') : undefined)
    }
  })

  nuxt.hook('nitro:init', (nitro) => {
    usesNitro = true
    nitro.hooks.hook('prerender:route', (route) => {
      // A skipped route fires the hook without being written.
      if (!route.error && !route.skip) {
        prerendered++
      }
    })
    nitro.hooks.hook('prerender:done', ({ failedRoutes }) => {
      // Nitro lists these at its `log` level, which the quiet build drops.
      if (failedRoutes.length && nitroQuieted) {
        logger.error(`Failed to prerender ${failedRoutes.length} route${failedRoutes.length === 1 ? '' : 's'}:\n${
          failedRoutes.map(formatFailedRoute).join('\n')}`)
      }
    })
    nitro.hooks.hook('compiled', async () => {
      isStatic = !!nitro.options.static
      deploy = nitro.options.commands?.deploy ? resolveDeployCommand(nitro) : undefined
      await measure(nitro.options.output.serverDir)
    })
  })

  return {
    summary(timings) {
      const lines: string[] = []
      const prerender = timings.find(timing => timing.phase === 'prerender')
      if (prerender && prerendered) {
        lines.push(`Prerendered ${prerendered} route${prerendered === 1 ? '' : 's'} in ${formatDuration(prerender.duration)}`)
      }
      // Without Nitro, the Vite server bundle is the server output.
      const server = timings.find(timing => timing.phase === (usesNitro ? 'bundle (nitro)' : 'bundle (server)'))
      // No size means nothing was written, as in a static build.
      if (!isStatic && server && size !== undefined) {
        const builder = usesNitro ? 'nitro' : (nuxt as unknown as MaybeServerBuild).serverBuild?.name || 'server'
        lines.push(`Server (${builder}) built in ${formatDuration(server.duration)}${styleText('dim', ` \u00B7 ${formatBytes(size)}`)}`)
      }
      return lines.length ? lines.join('\n') : undefined
    },
    commands() {
      const commands: string[] = []
      // A static preset writes no server to preview, but may still name a deploy command.
      if (!isStatic && size !== undefined) {
        commands.push(`You can preview this build using ${styleText('cyan', 'npx nuxt preview')}`)
      }
      if (deploy) {
        commands.push(`You can deploy this build using ${styleText('cyan', deploy)}`)
      }
      return commands
    },
  }
}

function formatFailedRoute(route: PrerenderRoute): string {
  // Nitro 2 sets `statusCode` and `statusMessage`; Nitro 3 `status` and `statusText`.
  const error = route.error as (PrerenderRoute['error'] & { status?: number, statusText?: string }) | undefined
  const status = [error?.statusCode ?? error?.status, error?.statusMessage ?? error?.statusText].filter(Boolean).join(' ')
  return `  ${route.route}${status ? styleText('dim', ` (${status})`) : ''}`
}

/**
 * The deploy command Nitro would print. Nitro 2 fills `{{ output.dir }}`
 * placeholders relative to the working directory; Nitro 3 names a command of
 * its own.
 */
function resolveDeployCommand(nitro: Nitro): string {
  const options = nitro.options as Nitro['options'] & { builder?: string, framework?: { deployCommand?: string } }
  if (options.builder) {
    return options.framework?.deployCommand || 'npx nitro deploy --prebuilt'
  }
  return options.commands.deploy!.replace(/\{\{ ?([\w.]+) ?\}\}/g, (match, key: string) => {
    const value = key.split('.').reduce<any>((object, part) => object?.[part], options)
    return typeof value === 'string' ? relative(process.cwd(), value) || '.' : match
  })
}

/** Bytes on disk under `dir`, leaving out source maps as Nitro's own total does. */
async function directorySize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && !SOURCE_MAP_RE.test(entry.name)) {
      total += (await stat(join(entry.parentPath, entry.name))).size
    }
  }
  return total
}
