import type { NuxtAnalyzeMeta } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'
import process from 'node:process'

import { styleText } from 'node:util'
import { intro, note, outro, taskLog } from '@clack/prompts'
import { defineCommand } from 'citty'
import { defu } from 'defu'
import { join, relative, resolve } from 'pathe'
import { serve } from 'srvx'

import { overrideEnv } from '../utils/env'
import { clearDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { acquireLock, acquireOutputLock, formatLockError } from '../utils/lockfile'
import { logger } from '../utils/logger'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { dotEnvArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

const NON_WORD_RE = /[^\w-]/g

const indexHtml = `
<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <title>Nuxt Bundle Stats (experimental)</title>
  </head>
    <h1>Nuxt Bundle Stats (experimental)</h1>
    <ul>
      <li>
        <a href="/nitro">Nitro server bundle stats</a>
      </li>
      <li>
        <a href="/client">Client bundle stats</a>
      </li>
    </ul>
  </html>
`.trim()

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
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolveRootDir(ctx.args)
    const name = ctx.args.name || 'default'
    const slug = name.trim().replace(NON_WORD_RE, '_') || 'default'

    intro(styleText('cyan', 'Analyzing bundle size...'))

    const startTime = Date.now()

    const { loadNuxt, buildNuxt } = await loadKit(cwd)

    const nuxt = await loadNuxt({
      cwd,
      ready: false,
      dotenv: {
        cwd,
        fileName: ctx.args.dotenv,
      },
      overrides: defu(ctx.data?.overrides, {
        ...(ctx.args.extends && { extends: ctx.args.extends }),
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

    await nuxt.ready()

    const analyzeDir = nuxt.options.analyzeDir
    const buildDir = nuxt.options.buildDir
    const outDir = resolve(nuxt.options.rootDir, nuxt.options.nitro.output?.dir || '.output')

    nuxt.options.build.analyze = defu(nuxt.options.build.analyze, {
      filename: join(analyzeDir, 'client.html'),
    })

    const lockInfo = { command: 'analyze' as const, cwd }
    const lock = acquireLock(buildDir, lockInfo)
    if (lock.existing) {
      logger.error(formatLockError(lock.existing))
      throw new Error(`Another Nuxt ${lock.existing.command} is already running (PID ${lock.existing.pid}).`)
    }

    const outputLock = acquireOutputLock(nuxt.options.rootDir, outDir, lockInfo)
    if (outputLock.existing) {
      lock.release()
      logger.error(formatLockError(outputLock.existing))
      throw new Error(`Another Nuxt build is already writing to ${relative(process.cwd(), outDir)} (PID ${outputLock.existing.pid}).`)
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
        outDir,
      }

      await nuxt.callHook('build:analyze:done', meta)
      await fsp.writeFile(join(analyzeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    }
    finally {
      outputLock.release()
      lock.release()
    }

    note(`${relativeToProcess(analyzeDir)}\n\nDo not deploy analyze results! Use ${styleText('cyan', 'nuxt build')} before deploying.`, 'Build location')

    if (ctx.args.serve !== false && !process.env.CI) {
      const headers = { 'content-type': 'text/html' }
      const readReport = (name: string) => fsp.readFile(join(analyzeDir, name), 'utf8').catch(() => undefined)
      const reports = new Map([
        ['/client', await readReport('client.html')],
        ['/nitro', await readReport('nitro.html')],
      ])

      logger.step('Starting stats server...')

      await serve({
        hostname: process.env.HOST || 'localhost',
        fetch(request) {
          const pathname = new URL(request.url).pathname.replace(/\/$/, '')
          if (reports.has(pathname)) {
            const report = reports.get(pathname)
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
