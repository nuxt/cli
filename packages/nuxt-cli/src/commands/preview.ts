import { existsSync, promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { box } from '@clack/prompts'
import { tokenizeArgs } from 'args-tokenizer'
import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import { x } from 'tinyexec'

import { resolveDotenvFileNames } from '../utils/args'
import { loadKit } from '../utils/kit'
import { logger, outro } from '../utils/logger'
import { withPrependedPath } from '../utils/path-env'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { getServerBuilderName } from '../utils/server-build'
import { findStaticEntry, previewStaticOutput } from '../utils/static-preview'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

const TRAILING_SLASH_RE = /\/$/

const command = defineCommand({
  meta: {
    name: 'preview',
    description: 'Launches Nitro server for local testing after `nuxt build`.',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...extendsArgs,
    port: {
      type: 'string',
      description: 'Port to listen on (default: `NUXT_PORT || NITRO_PORT || PORT`)',
      valueHint: 'port',
      alias: ['p'],
    },
    host: {
      type: 'string',
      description: 'Host to listen on (default: `NUXT_HOST || NITRO_HOST || HOST`)',
      valueHint: 'host',
      alias: ['h'],
    },
    ...dotEnvArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolveRootDir(ctx.args)

    let envLoaded = false
    let resolvedOutputDir: string | undefined
    let resolvedPublicDir: string | undefined
    let builderName: string | undefined

    try {
      const { loadNuxt } = await loadKit(cwd)
      const nuxt = await loadNuxt({
        cwd,
        dotenv: {
          cwd,
          fileName: resolveDotenvFileNames(ctx.args.dotenv),
        },
        envName: ctx.args.envName,
        ready: true,
        overrides: {
          ...(ctx.args.extends.length > 0 && { extends: ctx.args.extends }),
          modules: [
            function (_, nuxt) {
              envLoaded = true
              nuxt.hook('nitro:init', (nitro) => {
                resolvedOutputDir = resolve(nuxt.options.srcDir || cwd, nitro.options.output.dir || '.output', 'nitro.json')
              })
            },
          ],
        },
      })
      builderName = getServerBuilderName(nuxt)
      // `nuxt.serverOutput` is only present in newer Nuxt; the `nitro:init` hook
      // above covers older versions, which only ever built with Nitro.
      const serverOutput = (nuxt as { serverOutput?: { dir: () => string, publicDir: () => string } }).serverOutput
      if (serverOutput) {
        resolvedOutputDir = resolve(serverOutput.dir(), 'nitro.json')
        resolvedPublicDir = serverOutput.publicDir()
      }
      await nuxt.close()
    }
    catch {}

    const nitroJSONPaths = [...new Set([
      resolvedOutputDir,
      resolve(cwd, '.output', 'nitro.json'),
    ].filter((path): path is string => !!path))]
    const nitroJSONPath = nitroJSONPaths.find(p => existsSync(p))

    const port = ctx.args.port
      || process.env.NUXT_PORT
      || process.env.NITRO_PORT
      || process.env.PORT
    const host = ctx.args.host
      || process.env.NUXT_HOST
      || process.env.NITRO_HOST
      || process.env.HOST

    if (!nitroJSONPath) {
      // A build with no server runtime leaves only static files, which the CLI
      // can serve itself rather than reporting a missing server entry.
      const publicDirs = [...new Set([
        resolvedPublicDir,
        resolve(cwd, '.output', 'public'),
      ].filter((path): path is string => !!path))]
      for (const dir of publicDirs) {
        const entry = findStaticEntry(dir)
        if (entry) {
          logger.info(`This build has no server, so ${styleText('cyan', relativeToProcess(dir))} is being served statically.`)
          const server = await previewStaticOutput({ dir, entry, port, hostname: host })
          outro(`Previewing ${styleText('cyan', relativeToProcess(dir))} at ${styleText('cyan', server.url?.replace(TRAILING_SLASH_RE, '') || '')}`)
          return
        }
      }

      logger.error(
        `Cannot find a build to preview${builderName ? ` for the ${styleText('cyan', builderName)} server builder` : ''}. Did you run ${styleText('cyan', 'nuxt build')} first? Search path:\n${[...nitroJSONPaths, ...publicDirs].join('\n')}`,
      )
      process.exit(1)
    }
    const outputPath = dirname(nitroJSONPath)
    const nitroJSON = JSON.parse(await fsp.readFile(nitroJSONPath, 'utf-8'))

    const previewCommand = nitroJSON.commands?.preview
    if (typeof previewCommand !== 'string' || !previewCommand.trim()) {
      logger.error('Preview is not supported for this build.')
      process.exit(1)
    }

    const info = [
      ['Node.js:', `v${process.versions.node}`],
      ['Nitro preset:', nitroJSON.preset],
      ['Working directory:', relativeToProcess(outputPath)],
    ] as const
    const _infoKeyLen = Math.max(...info.map(([label]) => label.length))

    logger.message('')
    box(
      [
        '',
        'You are previewing a Nuxt app. In production, do not use this CLI. ',
        `Instead, run ${styleText('cyan', previewCommand)} directly.`,
        '',
        ...info.map(
          ([label, value]) =>
            `${label.padEnd(_infoKeyLen, ' ')} ${styleText('cyan', value)}`,
        ),
        '',
      ].join('\n'),
      styleText('yellow', ' Previewing Nuxt app '),
      {
        contentAlign: 'left',
        titleAlign: 'left',
        width: 'auto',
        titlePadding: 2,
        contentPadding: 2,
        rounded: true,
        withGuide: true,
        formatBorder: (text: string) => styleText('yellow', text),
      },
    )

    const envFileNames = resolveDotenvFileNames(ctx.args.dotenv) ?? ['.env']
    const existing = envFileNames.filter(fileName => existsSync(resolve(cwd, fileName)))
    const missing = envFileNames.filter(fileName => !existing.includes(fileName))

    if (existing.length > 0) {
      const list = existing.map(fileName => styleText('cyan', fileName)).join(', ')
      if (envLoaded) {
        logger.info(`Loaded ${list}. This will not be loaded when running the server in production.`)
      }
      else {
        logger.warn(`Could not load Nuxt, so ${list} may not be fully applied to the preview server.`)
      }
    }

    if (ctx.args.dotenv.length > 0 && missing.length > 0) {
      logger.error(`Cannot find ${missing.map(fileName => styleText('cyan', fileName)).join(', ')}.`)
    }

    outro(`Running ${styleText('cyan', previewCommand)} in ${styleText('cyan', relativeToProcess(outputPath))}`)

    const [command, ...commandArgs] = tokenizeArgs(previewCommand) as [string, ...string[]]
    await x(command, commandArgs, {
      throwOnError: true,
      nodeOptions: {
        stdio: 'inherit',
        cwd: outputPath,
        env: {
          ...withPrependedPath(process.env, [
            resolve(outputPath, 'node_modules/.bin'),
            resolve(cwd, 'node_modules/.bin'),
          ]),
          NUXT_PORT: port,
          NITRO_PORT: port,
          NUXT_HOST: host,
          NITRO_HOST: host,
        },
      },
    })
  },
})

export default command
