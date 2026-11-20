import type { Nuxt } from '@nuxt/schema'
import type { BuildProgress } from './build-progress'
import type { ServerBuild } from './server-build'

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { styleText } from 'node:util'
import { gzip } from 'node:zlib'

import { join, relative } from 'pathe'
import { isCI } from 'std-env'

import { formatBytes, formatDuration } from './formatting'
import { logger } from './logger'

/** A bundle Nuxt reports building, from any app or server builder. */
interface BuildEnvironment {
  /** Unique within a build, as the builder names it: `client`, `ssr`, `nitro`, ... */
  name: string
  consumer: 'client' | 'server'
  /** The tool that bundles it, such as `vite`, `webpack` or `rollup`. */
  builder: string
}

interface BuildFile {
  /** Relative to the bundle's `outDir`. */
  path: string
  size: number
}

interface BuildEnvironmentResult {
  duration: number
  outDir: string
  files: BuildFile[]
}

interface PrerenderedRoute {
  route: string
  duration: number
  fileName?: string
  skipped: boolean
  error?: { status?: number, message: string }
}

interface PrerenderResult {
  duration: number
  written: number
  failed: Array<{ route: string, status?: number, message: string }>
}

/** The hooks Nuxt reports a production build through. */
interface BuildReportHooks {
  'build:environment:start': (environment: BuildEnvironment) => void
  'build:environment:done': (environment: BuildEnvironment, result: BuildEnvironmentResult) => void
  'build:prerender:start': (info: { routes: number }) => void
  'build:prerender:route': (route: PrerenderedRoute) => void
  'build:prerender:done': (result: PrerenderResult) => void
}

type HookFn = <Name extends keyof BuildReportHooks>(name: Name, fn: BuildReportHooks[Name]) => void

interface BuildReportOptions {
  progress: BuildProgress
  /** The command to suggest for the full route list, such as `build` or `generate`. */
  command: string
}

interface Bundle {
  environment: BuildEnvironment
  result: BuildEnvironmentResult
  size: number
  gzip: Promise<number | undefined>
}

interface Entry {
  start: number
  render: (verbose: boolean) => Promise<string>
}

export interface BuildReport {
  /** One line per bundle and the prerender totals, in the order they ran; file tables when verbose. */
  summary: (verbose: boolean) => Promise<string | undefined>
  /** How to preview and deploy a build that has a server. */
  commands: (serverBuild: ServerBuild) => string[]
  /** Where a prerendered build can go. */
  staticCommands: (serverBuild: ServerBuild) => string[]
}

/** How many prerendered routes a local build lists before pointing at verbose output. */
const PRERENDER_ROUTE_LIMIT = 20

/** Source maps, which some builders write as `*.map.json`. */
const SOURCE_MAP_RE = /\.map(?:\.json)?$/

const GZIP_CONCURRENCY = 8

const LABELS: Record<string, string> = { ssr: 'server' }

/** What a bundle is called on the progress line and in the breakdown. */
function bundleLabel(environment: BuildEnvironment): string {
  return LABELS[environment.name] ?? environment.name
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Follow a production build through the hooks Nuxt reports it with, driving the
 * progress line and collecting what the summary prints once it is done.
 */
export function createBuildReport(nuxt: Nuxt, options: BuildReportOptions): BuildReport {
  const hook = nuxt.hook as unknown as HookFn
  const { progress } = options
  const entries: Entry[] = []
  const bundles: Bundle[] = []
  const routes: PrerenderedRoute[] = []
  const gzipFile = createLimiter(GZIP_CONCURRENCY)
  const starts = new Map<string, number>()
  let prerenderStart = 0

  hook('build:environment:start', (environment) => {
    starts.set(environment.name, Date.now())
    progress.startBundle(bundleLabel(environment))
  })

  hook('build:environment:done', (environment, result) => {
    progress.endBundle(bundleLabel(environment))
    const files = result.files.filter(file => !SOURCE_MAP_RE.test(file.path))
    const bundle: Bundle = {
      environment,
      result,
      size: files.reduce((sum, file) => sum + file.size, 0),
      gzip: environment.consumer === 'client'
        ? Promise.all(files.map(file => gzipFile(() => gzipSize(join(result.outDir, file.path))))).then(sizes => sizes.reduce((sum, size) => sum + size, 0), () => undefined)
        : Promise.resolve(undefined),
    }
    bundles.push(bundle)
    entries.push({
      start: starts.get(environment.name) ?? Date.now() - result.duration,
      render: verbose => formatBundle(bundle, files, verbose),
    })
  })

  hook('build:prerender:start', () => {
    prerenderStart = Date.now()
    routes.length = 0
    progress.startPrerender()
  })

  hook('build:prerender:route', (route) => {
    routes.push(route)
    progress.prerenderRoute(route.route, !route.skipped && !route.error)
  })

  hook('build:prerender:done', (result) => {
    progress.endPrerender()
    if (result.failed.length) {
      logger.error(`Failed to prerender ${result.failed.length} route${result.failed.length === 1 ? '' : 's'}:\n${
        result.failed.map(formatFailedRoute).join('\n')}`)
    }
    if (!result.written) {
      return
    }
    const command = nuxtCommand(nuxt, options.command)
    const written = [...routes]
    entries.push({
      start: prerenderStart || Date.now() - result.duration,
      render: async verbose => [
        `Prerendered ${result.written} route${result.written === 1 ? '' : 's'} in ${formatDuration(result.duration)}`,
        ...formatPrerenderedRoutes(written, command, verbose),
      ].join('\n'),
    })
  })

  /** Whether a server bundle was written into the build output, and so something to run. */
  function hasServerOutput(serverBuild: ServerBuild): boolean {
    return bundles.some(bundle => bundle.environment.consumer === 'server' && !relative(serverBuild.dir, bundle.result.outDir).startsWith('..'))
  }

  return {
    async summary(verbose) {
      const sorted = [...entries].sort((a, b) => a.start - b.start)
      const lines = await Promise.all(sorted.map(entry => entry.render(verbose)))
      return lines.length ? lines.join('\n') : undefined
    },
    commands(serverBuild) {
      const commands: string[] = []
      if (hasServerOutput(serverBuild)) {
        commands.push(`You can preview this build using ${styleText('cyan', nuxtCommand(nuxt, 'preview'))}`)
      }
      const deploy = serverBuild.deployCommand
      if (deploy) {
        commands.push(`You can deploy this build using ${styleText('cyan', deploy)}`)
      }
      return commands
    },
    staticCommands(serverBuild) {
      const target = serverBuild.target
      const publicDir = relative(process.cwd(), serverBuild.publicDir) || '.'
      // Only the generic target writes plain files that any static host serves.
      if (!target || target === 'static') {
        return [`You can now deploy ${styleText('cyan', publicDir)} to any static hosting`]
      }
      const deploy = serverBuild.deployCommand
      if (deploy) {
        return [`You can deploy this build using ${styleText('cyan', deploy)}`]
      }
      const dir = relative(process.cwd(), serverBuild.dir) || '.'
      return [`You can now deploy ${styleText('cyan', dir)} to ${styleText('cyan', target)}`]
    },
  }
}

async function formatBundle(bundle: Bundle, files: BuildFile[], verbose: boolean): Promise<string> {
  const { environment, result } = bundle
  const gzipped = await bundle.gzip
  const size = `${formatBytes(bundle.size)}${gzipped === undefined ? '' : ` (${formatBytes(gzipped)} gzip)`}`
  const line = `${capitalise(bundleLabel(environment))} ${styleText('dim', `(${environment.builder})`)} built in ${formatDuration(result.duration)}${styleText('dim', ` \u00B7 ${size}`)}`
  if (!verbose || !files.length) {
    return line
  }
  const sorted = [...files].sort((a, b) => b.size - a.size)
  const paths = sorted.map(file => relative(process.cwd(), join(result.outDir, file.path)))
  const sizes = sorted.map(file => formatBytes(file.size))
  const pathWidth = Math.max(...paths.map(path => path.length))
  const sizeWidth = Math.max(...sizes.map(size => size.length))
  return [line, ...paths.map((path, index) => `${path.padEnd(pathWidth)}  ${styleText('dim', sizes[index]!.padStart(sizeWidth))}`)].join('\n')
}

/** `npx nuxt <command>`, naming the project when it is not the current directory. */
function nuxtCommand(nuxt: Nuxt, command: string): string {
  const dir = relative(process.cwd(), nuxt.options.rootDir || process.cwd())
  return `npx nuxt ${command}${dir ? ` ${/\s/.test(dir) ? JSON.stringify(dir) : dir}` : ''}`
}

/**
 * The routes a build wrote. CI logs are read after the fact to check what was
 * deployed, so they list every route, skipped ones too, as does verbose output;
 * a terminal lists the first few and says how to see the rest.
 */
function formatPrerenderedRoutes(routes: PrerenderedRoute[], command: string, verbose: boolean): string[] {
  const all = isCI || verbose
  const listed = routes.filter(route => !route.error && (all || !route.skipped))
  const shown = all ? listed : listed.slice(0, PRERENDER_ROUTE_LIMIT)
  const width = Math.min(shown.reduce((max, route) => Math.max(max, route.route.length), 0), 60)
  const times = shown.map(route => route.skipped ? 'skipped' : formatRouteTime(route.duration))
  const timeWidth = times.reduce((max, time) => Math.max(max, time.length), 0)
  const lines = shown.map((route, index) => `${route.route.padEnd(width)}  ${styleText('dim', times[index]!.padStart(timeWidth))}`.trimEnd())
  const hidden = listed.length - shown.length
  if (hidden) {
    lines.push(styleText('dim', `\u2026 and ${hidden} more. Run ${styleText('cyan', `${command} --logLevel=verbose`)} to see all prerendered routes.`))
  }
  return lines
}

/** Whole milliseconds until a route takes seconds. */
function formatRouteTime(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : formatDuration(ms)
}

function formatFailedRoute(route: PrerenderResult['failed'][number]): string {
  const detail = [route.status, route.message].filter(Boolean).join(' ')
  return `${route.route}${detail ? styleText('dim', ` (${detail})`) : ''}`
}

async function gzipSize(path: string): Promise<number> {
  const content = await readFile(path)
  return new Promise((resolve, reject) => gzip(content, (error, result) => error ? reject(error) : resolve(result.byteLength)))
}

function createLimiter(concurrency: number) {
  let running = 0
  const queue: Array<() => void> = []
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const run = () => {
      running++
      task().then(resolve, reject).finally(() => {
        running--
        queue.shift()?.()
      })
    }
    if (running < concurrency) {
      run()
    }
    else {
      queue.push(run)
    }
  })
}
