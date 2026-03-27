import process from 'node:process'

import { intro, outro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { relative, resolve } from 'pathe'

import { showVersions } from '../utils/banner'
import { overrideEnv } from '../utils/env'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { checkLock, formatLockError, writeLock } from '../utils/lockfile'
import { logger } from '../utils/logger'
import { startCpuProfile, stopCpuProfile } from '../utils/profile'
import { cwdArgs, dotEnvArgs, envNameArgs, extendsArgs, legacyRootDirArgs, logLevelArgs, profileArgs } from './_shared'

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
    ...profileArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    overrideEnv('production')

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    const profileArg = ctx.args.profile
    const perfValue = profileArg === 'verbose' ? true : profileArg ? 'quiet' : undefined
    if (profileArg) {
      await startCpuProfile()
    }

    let lockCleanup: (() => void) | undefined
    try {
      intro(colors.cyan('Building Nuxt for production...'))

      const kit = await loadKit(cwd)

      await showVersions(cwd, kit, ctx.args.dotenv)

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
          ...((perfValue || ctx.data?.overrides?.debug) && {
            debug: {
              ...ctx.data?.overrides?.debug,
              ...(perfValue && { perf: perfValue }),
            },
          }),
        },
      })

      // Check for an existing process using the lock file (agent-only)
      const existing = checkLock(nuxt.options.buildDir)
      if (existing) {
        console.error(formatLockError(existing, cwd))
        process.exit(1)
      }
      lockCleanup = await writeLock(nuxt.options.buildDir, {
        pid: process.pid,
        command: 'build',
        startedAt: Date.now(),
      })

      let nitro: ReturnType<typeof kit.useNitro> | undefined
      // In Bridge, if Nitro is not enabled, useNitro will throw an error
      try {
        // Use ? for backward compatibility for Nuxt <= RC.10
        nitro = kit.useNitro?.()
        if (nitro) {
          logger.info(`Nitro preset: ${colors.cyan(nitro.options.preset)}`)
        }
      }
      catch {
        //
      }

      await clearBuildDir(nuxt.options.buildDir)

      await kit.writeTypes(nuxt)

      nuxt.hook('build:error', async (err) => {
        logger.error(`Nuxt build error: ${err}`)
        if (profileArg) {
          await stopCpuProfile(cwd, 'build')
        }
        process.exit(1)
      })

      await kit.buildNuxt(nuxt)

      if (ctx.args.prerender) {
        if (!nuxt.options.ssr) {
          logger.warn(`HTML content not prerendered because ${colors.cyan('ssr: false')} was set.`)
          logger.info(`You can read more in ${colors.cyan('https://nuxt.com/docs/getting-started/deployment#static-hosting')}.`)
        }
        // TODO: revisit later if/when nuxt build --prerender will output hybrid
        const dir = nitro?.options.output.publicDir
        const publicDir = dir ? relative(process.cwd(), dir) : '.output/public'
        outro(`✨ You can now deploy ${colors.cyan(publicDir)} to any static hosting!`)
      }
      else {
        outro('✨ Build complete!')
      }
    }
    finally {
      lockCleanup?.()
      if (profileArg) {
        await stopCpuProfile(cwd, 'build')
      }
    }
  },
})
