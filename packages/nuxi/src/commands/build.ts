import type { Nitro } from 'nitropack'

import process from 'node:process'

import { defineCommand } from 'citty'
import { relative, resolve } from 'pathe'

import { showVersions } from '../utils/banner'
import { overrideEnv } from '../utils/env'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'build',
    description: 'Build Nuxt for production deployment',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    prerender: {
      type: 'boolean',
      description: 'Build Nuxt and prerender static routes',
    },
    preset: {
      type: 'string',
      description: 'Nitro server preset',
    },
    ...dotEnvArgs,
    ...envNameArgs,
    ...extendsArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    showVersions(cwd)

    const kit = await loadKit(cwd)

    const nuxt = await kit.loadNuxt({
      cwd,
      dotenv: {
        cwd,
        fileName: ctx.args.dotenv,
      },
      envName: ctx.args.envName, // c12 will fall back to NODE_ENV
      overrides: {
        logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
        // TODO: remove in 3.8
        _generate: ctx.args.prerender,
        nitro: {
          static: ctx.args.prerender,
          preset: ctx.args.preset || process.env.NITRO_PRESET || process.env.SERVER_PRESET,
        },
        ...(ctx.args.extends && { extends: ctx.args.extends }),
        ...ctx.data?.overrides,
      },
    })

    let nitro: Nitro | undefined
    // In Bridge, if Nitro is not enabled, useNitro will throw an error
    try {
      // Use ? for backward compatibility for Nuxt <= RC.10
      nitro = kit.useNitro?.()
      logger.info(`Building for Nitro preset: \`${nitro.options.preset}\``)
    }
    catch {
      //
    }

    await clearBuildDir(nuxt.options.buildDir)

    await kit.writeTypes(nuxt)

    nuxt.hook('build:error', (err) => {
      logger.error('Nuxt Build Error:', err)
      process.exit(1)
    })

    await kit.buildNuxt(nuxt)

    if (ctx.args.prerender) {
      if (!nuxt.options.ssr) {
        logger.warn(
          'HTML content not prerendered because `ssr: false` was set. You can read more in `https://nuxt.com/docs/getting-started/deployment#static-hosting`.',
        )
      }
      // TODO: revisit later if/when nuxt build --prerender will output hybrid
      const dir = nitro?.options.output.publicDir
      const publicDir = dir ? relative(process.cwd(), dir) : '.output/public'
      logger.success(
        `You can now deploy \`${publicDir}\` to any static hosting!`,
      )
    }
  },
})
