import type { NuxtAnalyzeMeta } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'
import process from 'node:process'

import { intro, note, outro, taskLog } from '@clack/prompts'
import { defineCommand } from 'citty'
import { defu } from 'defu'
import { H3, lazyEventHandler } from 'h3-next'
import { join, resolve } from 'pathe'
import colors from 'picocolors'
import { serve } from 'srvx'

import { overrideEnv } from '../utils/env'
import { clearDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { cwdArgs, dotEnvArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

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
    description: 'Build nuxt and analyze production bundle (experimental)',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...legacyRootDirArgs,
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
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    const name = ctx.args.name || 'default'
    const slug = name.trim().replace(/[^\w-]/g, '_')

    intro(colors.cyan('Analyzing bundle size...'))

    const startTime = Date.now()

    const { loadNuxt, buildNuxt } = await loadKit(cwd)

    const nuxt = await loadNuxt({
      cwd,
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
      }),
    })

    const analyzeDir = nuxt.options.analyzeDir
    const buildDir = nuxt.options.buildDir
    const outDir
      = nuxt.options.nitro.output?.dir || join(nuxt.options.rootDir, '.output')

    nuxt.options.build.analyze = defu(nuxt.options.build.analyze, {
      filename: join(analyzeDir, 'client.html'),
    })

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
    await fsp.writeFile(join(analyzeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

    note(`${relativeToProcess(analyzeDir)}\n\nDo not deploy analyze results! Use ${colors.cyan('nuxt build')} before deploying.`, 'Analyze results')

    if (ctx.args.serve !== false && !process.env.CI) {
      const app = new H3()

      const opts = { headers: { 'content-type': 'text/html' } }
      const serveFile = (filePath: string) => lazyEventHandler(async () => {
        const contents = await fsp.readFile(filePath, 'utf-8')
        return () => new Response(contents, opts)
      })

      logger.step('Starting stats server...')

      app.use('/client', serveFile(join(analyzeDir, 'client.html')))
      app.use('/nitro', serveFile(join(analyzeDir, 'nitro.html')))
      app.use(() => new Response(indexHtml, opts))

      await serve(app).serve()
    }
    else {
      outro('✨ Analysis complete!')
    }
  },
})
