import { existsSync, promises as fsp } from 'node:fs'
import { dirname, relative } from 'node:path'
import process from 'node:process'

import { setupDotenv } from 'c12'
import { defineCommand } from 'citty'
import { box, colors } from 'consola/utils'
import { resolve } from 'pathe'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, envNameArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'preview',
    description: 'Launches Nitro server for local testing after `nuxi build`.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...legacyRootDirArgs,
    ...dotEnvArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const { loadNuxtConfig } = await loadKit(cwd)
    const config = await loadNuxtConfig({
      cwd,
      envName: ctx.args.envName, // c12 will fall back to NODE_ENV
      overrides: /* ctx.options?.overrides || */ {},
    })

    const resolvedOutputDir = resolve(
      config.srcDir || cwd,
      config.nitro.output?.dir || '.output',
      'nitro.json',
    )
    const defaultOutput = resolve(cwd, '.output', 'nitro.json') // for backwards compatibility

    const nitroJSONPaths = [resolvedOutputDir, defaultOutput]
    const nitroJSONPath = nitroJSONPaths.find(p => existsSync(p))
    if (!nitroJSONPath) {
      logger.error(
        'Cannot find `nitro.json`. Did you run `nuxi build` first? Search path:\n',
        nitroJSONPaths,
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
      ['Nitro Preset:', nitroJSON.preset],
      ['Working directory:', relative(process.cwd(), outputPath)],
    ] as const
    const _infoKeyLen = Math.max(...info.map(([label]) => label.length))

    logger.log(
      box(
        [
          'You are running Nuxt production build in preview mode.',
          `For production deployments, please directly use ${colors.cyan(
            nitroJSON.commands.preview,
          )} command.`,
          '',
          ...info.map(
            ([label, value]) =>
              `${label.padEnd(_infoKeyLen, ' ')} ${colors.cyan(value)}`,
          ),
        ].join('\n'),
        {
          title: colors.yellow('Preview Mode'),
          style: {
            borderColor: 'yellow',
          },
        },
      ),
    )

    if (typeof ctx.args.dotenv === 'string') {
      const envFileName = ctx.args.dotenv || '.env'

      const envExists = existsSync(resolve(cwd, envFileName))

      if (envExists) {
        logger.info(
          `Loading \`${envFileName}\`. This will not be loaded when running the server in production.`,
        )

        await setupDotenv({ cwd, fileName: envFileName })
      }
      else {
        logger.error(`Cannot find \`${envFileName}\`.`)
        process.exit(1)
      }
    }

    logger.info(`Starting preview command: \`${nitroJSON.commands.preview}\``)
    const [command, ...commandArgs] = nitroJSON.commands.preview.split(' ')
    logger.log('')
    await x(command, commandArgs, { nodeOptions: { stdio: 'inherit', cwd: outputPath } })
  },
})
