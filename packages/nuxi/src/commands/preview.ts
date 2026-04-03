import { existsSync, promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

import { box, outro } from '@clack/prompts'
import { setupDotenv } from 'c12'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

const command = defineCommand({
  meta: {
    name: 'preview',
    description: 'Launches Nitro server for local testing after `nuxi build`.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
    port: {
      type: 'string',
      description: 'Port to listen on',
      alias: ['p'],
    },
    ...dotEnvArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const defaultOutput = resolve(cwd, '.output', 'nitro.json')

    let nitroJSONPath: string | undefined

    // Try the default output path first to avoid loading Nuxt (which runs
    // module setup and may emit warnings about missing env vars that are
    // already baked into the build output).
    if (existsSync(defaultOutput)) {
      nitroJSONPath = defaultOutput
    }
    else {
      const { loadNuxt } = await loadKit(cwd)

      const resolvedOutputDir = await new Promise<string>((res) => {
        loadNuxt({
          cwd,
          dotenv: {
            cwd,
            fileName: ctx.args.dotenv,
          },
          envName: ctx.args.envName, // c12 will fall back to NODE_ENV
          ready: true,
          overrides: {
            ...(ctx.args.extends && { extends: ctx.args.extends }),
            modules: [
              function (_, nuxt) {
                nuxt.hook('nitro:init', (nitro) => {
                  res(resolve(nuxt.options.srcDir || cwd, nitro.options.output.dir || '.output', 'nitro.json'))
                })
              },
            ],
          },
        }).then(nuxt => nuxt.close()).catch(() => '')
      })

      if (resolvedOutputDir && existsSync(resolvedOutputDir)) {
        nitroJSONPath = resolvedOutputDir
      }
    }

    if (!nitroJSONPath) {
      logger.error(
        `Cannot find ${colors.cyan('nitro.json')}. Did you run ${colors.cyan('nuxi build')} first? Search path:\n${defaultOutput}`,
      )
      process.exit(1)
    }
    const outputPath = dirname(nitroJSONPath)
    const nitroJSON = JSON.parse(await fsp.readFile(nitroJSONPath, 'utf-8'))

    if (!nitroJSON.commands.preview) {
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
        `Instead, run ${colors.cyan(nitroJSON.commands.preview)} directly.`,
        '',
        ...info.map(
          ([label, value]) =>
            `${label.padEnd(_infoKeyLen, ' ')} ${colors.cyan(value)}`,
        ),
        '',
      ].join('\n'),
      colors.yellow(' Previewing Nuxt app '),
      {
        contentAlign: 'left',
        titleAlign: 'left',
        width: 'auto',
        titlePadding: 2,
        contentPadding: 2,
        rounded: true,
        withGuide: true,
        formatBorder: (text: string) => colors.yellow(text),
      },
    )

    const envFileName = ctx.args.dotenv || '.env'

    const envExists = existsSync(resolve(cwd, envFileName))

    if (envExists) {
      logger.info(
        `Loading ${colors.cyan(envFileName)}. This will not be loaded when running the server in production.`,
      )
      await setupDotenv({ cwd, fileName: envFileName })
    }
    else if (ctx.args.dotenv) {
      logger.error(`Cannot find ${colors.cyan(envFileName)}.`)
    }

    const port = ctx.args.port
      ?? process.env.NUXT_PORT
      ?? process.env.NITRO_PORT
      ?? process.env.PORT

    outro(`Running ${colors.cyan(nitroJSON.commands.preview)} in ${colors.cyan(relativeToProcess(outputPath))}`)

    const [command, ...commandArgs] = nitroJSON.commands.preview.split(' ')
    await x(command, commandArgs, {
      throwOnError: true,
      nodeOptions: {
        stdio: 'inherit',
        cwd: outputPath,
        env: {
          ...process.env,
          NUXT_PORT: port,
          NITRO_PORT: port,
        },
      },
    })
  },
})

export default command
