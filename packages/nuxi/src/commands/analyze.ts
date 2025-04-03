import type { NuxtAnalyzeMeta } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'
import process from 'node:process'

import { defineCommand } from 'citty'
import { defu } from 'defu'
import { createApp, eventHandler, lazyEventHandler, toNodeListener } from 'h3'
import { listen } from 'listhen'
import { join, resolve } from 'pathe'

import { overrideEnv } from '../utils/env'
import { clearDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'analyze',
    description: 'Build nuxt and analyze production bundle (experimental)',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...legacyRootDirArgs,
    ...dotEnvArgs,
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
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    const name = ctx.args.name || 'default'
    const slug = name.trim().replace(/[^\w-]/g, '_')

    const startTime = Date.now()

    const { loadNuxt, buildNuxt } = await loadKit(cwd)

    const nuxt = await loadNuxt({
      cwd,
      dotenv: {
        cwd,
        fileName: ctx.args.dotenv,
      },
      overrides: defu(ctx.data?.overrides, {
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
      }),
    })

    const analyzeDir = nuxt.options.analyzeDir
    const buildDir = nuxt.options.buildDir
    const outDir
      = nuxt.options.nitro.output?.dir || join(nuxt.options.rootDir, '.output')

    nuxt.options.build.analyze = defu(nuxt.options.build.analyze, {
      filename: join(analyzeDir, 'client.html'),
    })

    await clearDir(analyzeDir)
    await buildNuxt(nuxt)

    const endTime = Date.now()

    const meta: NuxtAnalyzeMeta = {
      name,
      slug,
      startTime,
      endTime,
      analyzeDir,
      buildDir,
      outDir,
    }

    await nuxt.callHook('build:analyze:done', meta)
    await fsp.writeFile(
      join(analyzeDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf-8',
    )

    logger.info(`Analyze results are available at: \`${analyzeDir}\``)
    logger.warn('Do not deploy analyze results! Use `nuxi build` before deploying.')

    if (ctx.args.serve !== false && !process.env.CI) {
      const app = createApp()

      const serveFile = (filePath: string) =>
        lazyEventHandler(async () => {
          const contents = await fsp.readFile(filePath, 'utf-8')
          return eventHandler((event) => {
            event.node.res.end(contents)
          })
        })

      logger.info('Starting stats server...')

      app.use('/client', serveFile(join(analyzeDir, 'client.html')))
      app.use('/nitro', serveFile(join(analyzeDir, 'nitro.html')))
      app.use(
        eventHandler(
          () => `<!DOCTYPE html>
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
      `,
        ),
      )

      await listen(toNodeListener(app))
    }
  },
})
