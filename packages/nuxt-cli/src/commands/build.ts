import process from 'node:process'

import { styleText } from 'node:util'
import { intro, outro } from '@clack/prompts'
import { defineCommand } from 'citty'

import { relative } from 'pathe'
import { showBanner } from '../utils/banner'

import { overrideEnv } from '../utils/env'
import { formatDuration } from '../utils/formatting'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { acquireLock, acquireOutputLock, formatLockError } from '../utils/lockfile'
import { logger } from '../utils/logger'
import { resolveRootDir } from '../utils/paths'
import { startCpuProfile, stopCpuProfile } from '../utils/profile'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, profileArgs, rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'build',
    description: 'Build Nuxt for production deployment',
  },
  args: {
    ...rootDirArgs,
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
  },
  async run(ctx) {
    overrideEnv('production')

    const start = Date.now()

    const cwd = resolveRootDir(ctx.args)

    const profileArg = ctx.args.profile
    const profiling = profileArg !== undefined
    const perfValue = profileArg === 'verbose' ? true : profiling ? 'quiet' : undefined
    if (profiling) {
      await startCpuProfile()
    }

    const releaseLocks: Array<() => void> = []
    try {
      intro(styleText('cyan', 'Building Nuxt for production...'))

      const kit = await loadKit(cwd)
      const nuxt = await kit.loadNuxt({
        cwd,
        ready: false,
        dotenv: {
          cwd,
          fileName: ctx.args.dotenv,
        },
        envName: ctx.args.envName, // nuxt will fall back to NODE_ENV
        overrides: {
          logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
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

      showBanner(nuxt)
      await nuxt.ready()

      const lock = acquireLock(nuxt.options.buildDir, {
        command: 'build',
        cwd,
      })
      if (lock.existing) {
        logger.error(formatLockError(lock.existing))
        throw new Error(`Another Nuxt ${lock.existing.command} is already running (PID ${lock.existing.pid}).`)
      }
      releaseLocks.push(lock.release)

      const nitro = kit.useNitro()
      logger.info(`Nitro preset: ${styleText('cyan', nitro.options.preset)}`)

      const outputLock = acquireOutputLock(nuxt.options.rootDir, nitro.options.output.dir, {
        command: 'build',
        cwd,
      })
      if (outputLock.existing) {
        logger.error(formatLockError(outputLock.existing))
        throw new Error(`Another Nuxt build is already writing to ${relative(process.cwd(), nitro.options.output.dir)} (PID ${outputLock.existing.pid}).`)
      }
      releaseLocks.push(outputLock.release)

      await clearBuildDir(nuxt.options.buildDir)

      await kit.writeTypes(nuxt)

      await kit.buildNuxt(nuxt)

      if (ctx.args.prerender) {
        if (!nuxt.options.ssr) {
          logger.warn(`HTML content not prerendered because ${styleText('cyan', 'ssr: false')} was set.`)
          logger.info(`You can read more in ${styleText('cyan', 'https://nuxt.com/docs/getting-started/deployment#static-hosting')}.`)
        }
        const dir = nitro.options.output.publicDir
        const publicDir = dir ? relative(process.cwd(), dir) : '.output/public'
        outro(`✨ You can now deploy ${styleText('cyan', publicDir)} to any static hosting! ${styleText('gray', `(${formatDuration(Date.now() - start)})`)}`)
      }
      else {
        outro(`✨ Build complete in ${styleText('cyan', formatDuration(Date.now() - start))}!`)
      }
    }
    finally {
      for (const release of releaseLocks.reverse()) {
        release()
      }
      if (profiling) {
        await stopCpuProfile(cwd, 'build')
      }
    }
  },
})
