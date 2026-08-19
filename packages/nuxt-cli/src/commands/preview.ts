import { existsSync, promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { box, outro } from '@clack/prompts'
import { tokenizeArgs } from 'args-tokenizer'
import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import { x } from 'tinyexec'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { withPrependedPath } from '../utils/path-env'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

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
      alias: ['p'],
    },
    host: {
      type: 'string',
      description: 'Host to listen on (default: `NUXT_HOST || NITRO_HOST || HOST`)',
      alias: ['h'],
    },
    ...dotEnvArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolveRootDir(ctx.args)

    let envLoaded = false
    let resolvedOutputDir: string | undefined

    try {
      const { loadNuxt } = await loadKit(cwd)
      const nuxt = await loadNuxt({
        cwd,
        dotenv: {
          cwd,
          fileName: ctx.args.dotenv,
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
      await nuxt.close()
    }
    catch {}

    const nitroJSONPaths = [...new Set([
      resolvedOutputDir,
      resolve(cwd, '.output', 'nitro.json'),
    ].filter((path): path is string => !!path))]
    const nitroJSONPath = nitroJSONPaths.find(p => existsSync(p))
    if (!nitroJSONPath) {
      logger.error(
        `Cannot find ${styleText('cyan', 'nitro.json')}. Did you run ${styleText('cyan', 'nuxt build')} first? Search path:\n${nitroJSONPaths.join('\n')}`,
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

    const envFileName = ctx.args.dotenv || '.env'

    const envExists = existsSync(resolve(cwd, envFileName))

    if (envExists) {
      if (envLoaded) {
        logger.info(
          `Loaded ${styleText('cyan', envFileName)}. This will not be loaded when running the server in production.`,
        )
      }
      else {
        logger.warn(
          `Could not load Nuxt, so ${styleText('cyan', envFileName)} may not be fully applied to the preview server.`,
        )
      }
    }
    else if (ctx.args.dotenv) {
      logger.error(`Cannot find ${styleText('cyan', envFileName)}.`)
    }

    const port = ctx.args.port
      || process.env.NUXT_PORT
      || process.env.NITRO_PORT
      || process.env.PORT
    const host = ctx.args.host
      || process.env.NUXT_HOST
      || process.env.NITRO_HOST
      || process.env.HOST

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
