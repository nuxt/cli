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

const REPORTS = [
  { path: '/client', file: 'client.html', label: 'Client bundle stats' },
  { path: '/nitro', file: 'nitro.html', label: 'Nitro server bundle stats' },
]

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
        // The webpack and rspack builders open their report in a browser; the CLI serves it instead.
        webpack: {
          analyze: {
            openAnalyzer: false,
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

    // Each named run gets its own directory so earlier runs are kept for comparison.
    // This has to happen before `ready()`, as modules and Nitro read `analyzeDir` while initialising.
    const baseAnalyzeDir = nuxt.options.analyzeDir
    const analyzeDir = join(baseAnalyzeDir, slug)
    nuxt.options.analyzeDir = analyzeDir

    const analyzeOptions = nuxt.options.build.analyze as Exclude<typeof nuxt.options.build.analyze, boolean> & { filename?: string, template?: string }
    if (ctx.args.json) {
      analyzeOptions.template = 'raw-data'
    }
    // Only move the default report location; a custom `build.analyze.filename` is kept as is.
    if (!analyzeOptions.filename || analyzeOptions.filename === join(baseAnalyzeDir, '{name}.html')) {
      analyzeOptions.filename = join(analyzeDir, ctx.args.json ? '{name}.json' : '{name}.html')
    }

    if (ctx.args.json) {
      // Nuxt DevTools adds `vite-plugin-inspect` to analyze builds for its own UI, which JSON consumers do not need.
      // Set after `loadNuxt()` has decided whether to install DevTools, so the user's `enabled` choice is kept.
      const devtools = nuxt.options.devtools
      nuxt.options.devtools = typeof devtools === 'object' ? { ...devtools, viteInspect: false } : { enabled: devtools, viteInspect: false }

      // Nitro v2 gets its own analyze options, so the server report needs the same treatment.
      nuxt.hook('nitro:config', (nitroConfig) => {
        if (!nitroConfig.analyze) {
          return
        }
        nitroConfig.analyze.template = 'raw-data'
        if (!nitroConfig.analyze.filename || nitroConfig.analyze.filename === join(analyzeDir, '{name}.html')) {
          nitroConfig.analyze.filename = join(analyzeDir, '{name}.json')
        }
      })
    }

    // Nitro v2 adds the visualizer from its `analyze` option, which Nitro v3 (Nuxt 5) no longer has.
    // When it is missing, Nuxt's Vite builder already offers to install it for the client report.
    nuxt.hook('nitro:init', (nitro) => {
      nitro.hooks.hook('rollup:before', async (_nitro, config) => {
        const plugins = ([await config.plugins] as unknown[]).flat(Infinity).filter(Boolean) as { name?: string }[]
        if (plugins.some(plugin => plugin.name === 'visualizer')) {
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
        config.plugins = [...plugins, visualizer({
          template: ctx.args.json ? 'raw-data' : 'treemap',
          projectRoot: nuxt.options.rootDir,
          filename: join(analyzeDir, ctx.args.json ? 'nitro.json' : 'nitro.html'),
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
      const reports = await Promise.all(REPORTS.map(async report => ({
        ...report,
        html: await fsp.readFile(join(analyzeDir, report.file), 'utf8').catch(() => undefined),
      })))
      const contents = new Map(reports.map(report => [report.path, report.html]))
      const generated = reports.filter(report => report.html !== undefined)
      // With a single report, there is nothing to choose from, so serve it directly.
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
