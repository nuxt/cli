import type { NuxtAnalyzeMeta } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { styleText } from 'node:util'
import { note, taskLog } from '@clack/prompts'
import { defineCommand } from 'citty'
import { defu } from 'defu'
import { resolveModulePath } from 'exsolve'
import { getPort } from 'get-port-please'
import { join, relative } from 'pathe'
import { serve } from 'srvx'

import { isAllowedHost, resolveNuxtAllowedHosts } from '../dev/host-check'
import { resolveDotenvFileNames } from '../utils/args'
import { overrideEnv } from '../utils/env'
import { ActionableError } from '../utils/errors'
import { clearDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { acquireLock, acquireOutputLock, formatLockError } from '../utils/lockfile'
import { intro, logger, outro } from '../utils/logger'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { resolveServerBuild } from '../utils/server-build'
import { dotEnvArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

const NON_WORD_RE = /[^\w-]/g
const HTML_EXT_RE = /\.html$/

const LEGACY_REPORT_FILES = ['client.html', 'client.json', 'nitro.html', 'meta.json', '.vite-inspect']

interface ReportOptions {
  filename?: string
  template?: string
}

interface WebpackAnalyzeOptions {
  enabled?: boolean
  openAnalyzer?: boolean
  analyzerMode?: string
  generateStatsFile?: boolean
}

function resolveReportFilename(filename: string | undefined, defaultFilename: string, dir: string, json: boolean) {
  if (!filename || filename === defaultFilename) {
    return join(dir, json ? '{name}.json' : '{name}.html')
  }
  return json ? filename.replace(HTML_EXT_RE, '.json') : filename
}

async function readFirstFile(files: (string | undefined)[]) {
  for (const file of files) {
    if (!file) {
      continue
    }
    const contents = await fsp.readFile(file, 'utf8').catch(() => undefined)
    if (contents !== undefined) {
      return contents
    }
  }
}

function renderIndexHtml(reports: { path: string, label: string }[]) {
  const body = reports.length > 0
    ? `<ul>\n${reports.map(report => `      <li>\n        <a href="${report.path}">${report.label}</a>\n      </li>`).join('\n')}\n    </ul>`
    : '<p>The analyze build did not generate any bundle reports.</p>'
  return `
<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <title>Nuxt Bundle Stats (experimental)</title>
  </head>
    <h1>Nuxt Bundle Stats (experimental)</h1>
    ${body}
  </html>
`.trim()
}

export default defineCommand({
  meta: {
    name: 'analyze',
    description: 'Build Nuxt and analyze production bundle (experimental)',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...dotEnvArgs,
    ...extendsArgs,
    name: {
      type: 'string',
      description: 'Name of the analysis',
      default: 'default',
      valueHint: 'name',
    },
    serve: {
      type: 'boolean',
      description: 'Serve the analysis results',
      negativeDescription: 'Skip serving the analysis results',
      default: true,
    },
    prerender: {
      type: 'boolean',
      description: 'Prerender routes while analyzing',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Write the client and server bundle analysis as JSON instead of HTML (implies --no-serve)',
      default: false,
    },
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolveRootDir(ctx.args)
    const name = ctx.args.name || 'default'
    const slug = name.trim().replace(NON_WORD_RE, '_') || 'default'

    intro(styleText('cyan', 'Analyzing bundle size...'))

    const startTime = Date.now()

    const kit = await loadKit(cwd)
    const { loadNuxt, buildNuxt } = kit

    const nuxt = await loadNuxt({
      cwd,
      ready: false,
      dotenv: {
        cwd,
        fileName: resolveDotenvFileNames(ctx.args.dotenv),
      },
      overrides: defu(ctx.data?.overrides, {
        ...(ctx.args.extends.length > 0 && { extends: ctx.args.extends }),
        build: {
          analyze: {
            enabled: true,
          },
        },
        vite: {
          build: {
            rollupOptions: {
              output: {
                chunkFileNames: '_nuxt/[name].js',
                entryFileNames: '_nuxt/[name].js',
              },
            },
          },
        },
        logLevel: ctx.args.logLevel,
        ...(!ctx.args.prerender && {
          nitro: {
            prerender: {
              routes: [],
              crawlLinks: false,
              ignore: [() => true],
            },
          },
        }),
      }),
    })

    let skippedPrerenderRoutes = 0
    if (!ctx.args.prerender) {
      nuxt.hook('nitro:init', (nitro) => {
        nitro.hooks.hook('prerender:routes', (routes) => {
          skippedPrerenderRoutes = routes.size
          routes.clear()
        })
      })
    }

    // Modules and Nitro read `analyzeDir` while initialising, so it has to be set before `ready()`.
    const baseAnalyzeDir = nuxt.options.analyzeDir
    const analyzeDir = join(baseAnalyzeDir, slug)
    nuxt.options.analyzeDir = analyzeDir

    const analyzeOptions = nuxt.options.build.analyze as Exclude<typeof nuxt.options.build.analyze, boolean> & ReportOptions
    if (ctx.args.json) {
      analyzeOptions.template = 'raw-data'
    }
    analyzeOptions.filename = resolveReportFilename(analyzeOptions.filename, join(baseAnalyzeDir, '{name}.html'), analyzeDir, ctx.args.json)

    const webpackAnalyze = (nuxt.options as { webpack?: { analyze?: boolean | WebpackAnalyzeOptions } }).webpack?.analyze
    if (webpackAnalyze && typeof webpackAnalyze === 'object' && webpackAnalyze.enabled !== false) {
      webpackAnalyze.openAnalyzer = false
      if (ctx.args.json) {
        webpackAnalyze.analyzerMode = 'disabled'
        webpackAnalyze.generateStatsFile = true
      }
    }

    if (ctx.args.json) {
      // `loadNuxt()` has already decided whether to install DevTools, so the user's `enabled` choice is kept.
      const devtools = nuxt.options.devtools
      nuxt.options.devtools = typeof devtools === 'object' ? { ...devtools, viteInspect: false } : { enabled: devtools, viteInspect: false }
    }

    let nitroAnalyzeDisabled = false
    let nitroReportFile: string | undefined
    nuxt.hook('nitro:config', (nitroConfig) => {
      if (nitroConfig.analyze === false) {
        nitroAnalyzeDisabled = true
        return
      }
      if (!nitroConfig.analyze) {
        return
      }
      if (ctx.args.json) {
        nitroConfig.analyze.template = 'raw-data'
        nitroConfig.analyze.filename = resolveReportFilename(nitroConfig.analyze.filename, join(analyzeDir, '{name}.html'), analyzeDir, true)
      }
      nitroReportFile = nitroConfig.analyze.filename?.replace('{name}', 'nitro')
    })

    // Nitro v3 has no `analyze` option, so the server report needs its own visualizer.
    nuxt.hook('nitro:init', (nitro) => {
      nitro.hooks.hook('rollup:before', async (_nitro, config) => {
        const plugins = ([await config.plugins] as unknown[]).flat(Infinity).filter(Boolean) as { name?: string }[]
        if (nitroAnalyzeDisabled || plugins.some(plugin => plugin.name === 'visualizer')) {
          return
        }
        const visualizerPath = resolveModulePath('rollup-plugin-visualizer', {
          from: [nuxt.options.rootDir, ...nuxt.options.modulesDir].map(dir => join(dir, '/')),
          try: true,
        })
        if (!visualizerPath) {
          return
        }
        const { visualizer } = await import(pathToFileURL(visualizerPath).href)
        nitroReportFile = join(analyzeDir, ctx.args.json ? 'nitro.json' : 'nitro.html')
        config.plugins = [...plugins, visualizer({
          template: ctx.args.json ? 'raw-data' : 'treemap',
          projectRoot: nuxt.options.rootDir,
          filename: nitroReportFile,
          title: 'Nitro Server bundle stats',
        })] as typeof config.plugins
      })
    })

    await nuxt.ready()

    const buildDir = nuxt.options.buildDir
    const serverBuild = resolveServerBuild(kit, nuxt)
    // The lock has to be taken before the build, so it claims the output
    // directory as resolved now; `meta.json` records where the build landed.
    const outDir = serverBuild.dir

    const lockInfo = { command: 'analyze' as const, cwd }
    const lock = acquireLock(buildDir, lockInfo)
    if (lock.existing) {
      throw new ActionableError(formatLockError(lock.existing))
    }

    const outputLock = acquireOutputLock(nuxt.options.rootDir, outDir, lockInfo)
    if (outputLock.existing) {
      lock.release()
      throw new ActionableError(formatLockError(outputLock.existing, { outputDir: relative(process.cwd(), outDir) }))
    }

    try {
      const tasklog = taskLog({
        title: 'Building Nuxt with analysis enabled',
        retainLog: false,
        limit: 1,
      })

      tasklog.message('Clearing analyze directory...')
      await Promise.all(LEGACY_REPORT_FILES.map(file => fsp.rm(join(baseAnalyzeDir, file), { recursive: true, force: true })))
      await clearDir(analyzeDir)
      tasklog.message('Building Nuxt...')
      await buildNuxt(nuxt)
      tasklog.success('Build complete')

      if (skippedPrerenderRoutes > 0) {
        logger.info(`Skipped prerendering ${skippedPrerenderRoutes} route${skippedPrerenderRoutes === 1 ? '' : 's'}. Pass ${styleText('cyan', '--prerender')} to include assets emitted while prerendering.`)
      }

      const meta: NuxtAnalyzeMeta = {
        name,
        slug,
        startTime,
        endTime: Date.now(),
        analyzeDir,
        buildDir,
        outDir: serverBuild.dir,
      }

      await nuxt.callHook('build:analyze:done', meta)
      await fsp.writeFile(join(analyzeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    }
    finally {
      outputLock.release()
      lock.release()
    }

    note(`${relativeToProcess(analyzeDir)}\n\nDo not deploy analyze results! Use ${styleText('cyan', 'nuxt build')} before deploying.`, 'Build location')

    if (ctx.args.serve !== false && !ctx.args.json && !process.env.CI) {
      const headers = { 'content-type': 'text/html' }
      const reports = [
        { path: '/client', label: 'Client bundle stats', html: await readFirstFile([analyzeOptions.filename.replace('{name}', 'client'), join(analyzeDir, 'client.html')]) },
        { path: '/nitro', label: 'Nitro server bundle stats', html: await readFirstFile([nitroReportFile, join(analyzeDir, 'nitro.html')]) },
      ]
      const contents = new Map(reports.map(report => [report.path, report.html]))
      const generated = reports.filter(report => report.html !== undefined)
      const indexHtml = generated.length === 1 ? generated[0]!.html! : renderIndexHtml(generated)

      logger.step('Starting stats server...')

      const hostname = process.env.HOST || 'localhost'
      const requestedPort = Number(process.env.PORT) || 3000
      const port = await getPort({ port: requestedPort, alternativePortRange: [3000, 3100], host: hostname })
      if (port !== requestedPort) {
        logger.warn(`Port ${requestedPort} is in use, using port ${port} instead.`)
      }
      const configuredHosts = resolveNuxtAllowedHosts(nuxt.options)
      const allowedHosts = new Set([hostname, ...Array.isArray(configuredHosts) ? configuredHosts : []].map(host => host.toLowerCase()))

      await serve({
        hostname,
        port,
        fetch(request) {
          if (configuredHosts !== true && !isAllowedHost(request.headers.get('host') ?? undefined, allowedHosts)) {
            return new Response('Forbidden: this host is not allowed.', { status: 403, headers: { 'content-type': 'text/plain' } })
          }
          const pathname = new URL(request.url).pathname.replace(/\/$/, '')
          if (contents.has(pathname)) {
            const report = contents.get(pathname)
            return report === undefined
              ? new Response('This report was not generated by the analyze build.', { status: 404, headers })
              : new Response(report, { headers })
          }
          return new Response(indexHtml, { headers })
        },
      }).ready()
    }
    else {
      outro('✨ Analysis build complete!')
    }
  },
})
