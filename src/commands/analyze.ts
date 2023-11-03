import { promises as fsp } from 'node:fs'
import { join, resolve } from 'pathe'
import { createApp, eventHandler, lazyEventHandler, toNodeListener } from 'h3'
import { listen } from 'listhen'
import type { NuxtAnalyzeMeta } from '@nuxt/schema'
import { defu } from 'defu'
import { loadKit } from '../utils/kit'
import { clearDir } from '../utils/fs'
import { overrideEnv } from '../utils/env'
import { defineCommand } from 'citty'
import { sharedArgs, legacyRootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'analyze',
    description: 'Build nuxt and analyze production bundle (experimental)',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
    name: {
      type: 'string',
      description: 'Name of the analysis',
      default: 'default',
    },
    serve: {
      type: 'boolean',
      description: 'Serve the analysis results',
      default: true,
    },
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')
    const name = ctx.args.name || 'default'
    const slug = name.trim().replace(/[^a-z0-9_-]/gi, '_')

    const startTime = Date.now()

    const { loadNuxt, buildNuxt } = await loadKit(cwd)

    const nuxt = await loadNuxt({
      rootDir: cwd,
      overrides: defu(ctx.data?.overrides, {
        build: {
          analyze: {
            enabled: true,
          },
        },
        logLevel: ctx.args.logLevel,
      }),
    })

    const analyzeDir = nuxt.options.analyzeDir
    const buildDir = nuxt.options.buildDir
    const outDir =
      nuxt.options.nitro.output?.dir || join(nuxt.options.rootDir, '.output')

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

    console.info('Analyze results are available at: `' + analyzeDir + '`')
    console.warn(
      'Do not deploy analyze results! Use `nuxi build` before deploying.',
    )

    if (ctx.args.serve !== false && !process.env.CI) {
      const app = createApp()

      const serveFile = (filePath: string) =>
        lazyEventHandler(async () => {
          const contents = await fsp.readFile(filePath, 'utf-8')
          return eventHandler((event) => {
            event.node.res.end(contents)
          })
        })

      console.info('Starting stats server...')

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
