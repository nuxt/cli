import { existsSync, promises as fsp } from 'node:fs'
import { dirname, relative } from 'node:path'
import { execa } from 'execa'
import { setupDotenv } from 'c12'
import { resolve } from 'pathe'
import { consola } from 'consola'
import { loadKit } from '../utils/kit'

import { defineCommand } from 'citty'

import { legacyRootDirArgs, sharedArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'preview',
    description: 'Launches nitro server for local testing after `nuxi build`.',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
    dotenv: {
      type: 'string',
      description: 'Path to .env file',
    },
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    const { loadNuxtConfig } = await loadKit(cwd)
    const config = await loadNuxtConfig({
      cwd,
      overrides: /*ctx.options?.overrides || */ {},
    })

    const resolvedOutputDir = resolve(
      config.srcDir || cwd,
      config.nitro.srcDir || 'server',
      config.nitro.output?.dir || '.output',
      'nitro.json'
    )
    const defaultOutput = resolve(cwd, '.output', 'nitro.json') // for backwards compatibility

    const nitroJSONPaths = [resolvedOutputDir, defaultOutput]
    const nitroJSONPath = nitroJSONPaths.find((p) => existsSync(p))
    if (!nitroJSONPath) {
      consola.error(
        'Cannot find `nitro.json`. Did you run `nuxi build` first? Search path:\n',
        nitroJSONPaths
      )
      process.exit(1)
    }
    const outputPath = dirname(nitroJSONPath)
    const nitroJSON = JSON.parse(await fsp.readFile(nitroJSONPath, 'utf-8'))

    consola.info('Node.js version:', process.versions.node)
    consola.info('Preset:', nitroJSON.preset)
    consola.info('Working dir:', relative(process.cwd(), outputPath))

    if (!nitroJSON.commands.preview) {
      consola.error('Preview is not supported for this build.')
      process.exit(1)
    }

    const envExists = ctx.args.dotenv
      ? existsSync(resolve(cwd, ctx.args.dotenv))
      : existsSync(cwd)
    if (envExists) {
      consola.info(
        'Loading `.env`. This will not be loaded when running the server in production.'
      )
      await setupDotenv({ cwd, fileName: ctx.args.dotenv })
    }

    consola.info('Starting preview command:', nitroJSON.commands.preview)
    const [command, ...commandArgs] = nitroJSON.commands.preview.split(' ')
    consola.log('')
    await execa(command, commandArgs, { stdio: 'inherit', cwd: outputPath })
  },
})
