import process from 'node:process'

import { styleText } from 'node:util'
import { defineCommand } from 'citty'

import { relative } from 'pathe'
import { resolveDotenvFileNames } from '../utils/args'
import { showBanner } from '../utils/banner'
import { BuildProgress } from '../utils/build-progress'
import { overrideEnv } from '../utils/env'

import { ActionableError } from '../utils/errors'
import { formatDuration } from '../utils/formatting'
import { clearBuildDir } from '../utils/fs'
import { loadKit } from '../utils/kit'
import { acquireLock, acquireOutputLock, formatLockError } from '../utils/lockfile'
import { intro, logger, outro } from '../utils/logger'
import { resolveRootDir } from '../utils/paths'
import { createPhaseReporter, formatPhaseBreakdown } from '../utils/phase-reporter'
import { startCpuProfile, stopCpuProfile } from '../utils/profile'
import { resolveServerBuild } from '../utils/server-build'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, profileArgs, rootDirArgs } from './_shared'

/** How often a phase repeats itself where there is no animated line. */
const HEARTBEAT_INTERVAL = 5000

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
      description: 'Nitro server preset (e.g. `node-server`, `vercel`, `netlify`)',
      valueHint: 'nitro-preset',
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
    const progress = new BuildProgress()
    let stopReporting = () => {}
    try {
      intro(styleText('cyan', 'Building Nuxt for production...'))

      // The phase line owns a row of the terminal, which a silent build has no
      // business drawing on. Subscribed after the intro so the first phase is
      // reported below it rather than above.
      if (ctx.args.logLevel !== 'silent') {
        const reporter = createPhaseReporter({ heartbeat: HEARTBEAT_INTERVAL })
        let unsubscribe: (() => void) | undefined
        // Assigned before subscribing, because subscribing reports the phase in
        // flight straight away: a first write that fails, on a pipe that has
        // already been closed, must still leave the terminal recoverable.
        stopReporting = () => {
          unsubscribe?.()
          reporter.stop()
        }
        unsubscribe = progress.onUpdate(reporter.update)
      }

      const kit = await loadKit(cwd)
      const nuxt = await kit.loadNuxt({
        cwd,
        ready: false,
        dotenv: {
          cwd,
          fileName: resolveDotenvFileNames(ctx.args.dotenv),
        },
        envName: ctx.args.envName, // nuxt will fall back to NODE_ENV
        overrides: {
          logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose',
          _generate: ctx.args.prerender,
          nitro: {
            static: ctx.args.prerender,
            preset: ctx.args.preset || process.env.NITRO_PRESET || process.env.SERVER_PRESET,
          },
          ...(ctx.args.extends.length > 0 && { extends: ctx.args.extends }),
          ...ctx.data?.overrides,
          ...((perfValue || ctx.data?.overrides?.debug) && {
            debug: {
              ...ctx.data?.overrides?.debug,
              ...(perfValue && { perf: perfValue }),
            },
          }),
        },
      })

      progress.attachNuxt(nuxt)

      showBanner(nuxt)
      await nuxt.ready()

      const lock = acquireLock(nuxt.options.buildDir, {
        command: 'build',
        cwd,
      })
      if (lock.existing) {
        throw new ActionableError(formatLockError(lock.existing))
      }
      releaseLocks.push(lock.release)

      const serverBuild = resolveServerBuild(kit, nuxt)
      if (serverBuild.target) {
        logger.info(`${serverBuild.name === 'nitro' ? 'Nitro' : serverBuild.name} preset: ${styleText('cyan', serverBuild.target)}`)
      }

      const outputDir = serverBuild.dir
      const outputLock = acquireOutputLock(nuxt.options.rootDir, outputDir, {
        command: 'build',
        cwd,
      })
      if (outputLock.existing) {
        throw new ActionableError(formatLockError(outputLock.existing, { outputDir: relative(process.cwd(), outputDir) }))
      }
      releaseLocks.push(outputLock.release)

      await clearBuildDir(nuxt.options.buildDir)

      await kit.writeTypes(nuxt)

      await kit.buildNuxt(nuxt)

      stopReporting()
      progress.finish()

      const breakdown = formatPhaseBreakdown(progress.timings)
      if (breakdown) {
        logger.message(styleText('dim', breakdown))
      }

      if (ctx.args.prerender) {
        if (!nuxt.options.ssr) {
          logger.warn(`HTML content not prerendered because ${styleText('cyan', 'ssr: false')} was set.`)
          logger.info(`You can read more in ${styleText('cyan', 'https://nuxt.com/docs/getting-started/deployment#static-hosting')}.`)
        }
        const dir = serverBuild.publicDir
        const publicDir = dir ? relative(process.cwd(), dir) : '.output/public'
        outro(`✨ You can now deploy ${styleText('cyan', publicDir)} to any static hosting! ${styleText('gray', `(${formatDuration(Date.now() - start)})`)}`)
      }
      else {
        outro(`✨ Build complete in ${styleText('cyan', formatDuration(Date.now() - start))}!`)
      }
    }
    finally {
      stopReporting()
      for (const release of releaseLocks.reverse()) {
        release()
      }
      if (profiling) {
        await stopCpuProfile(cwd, 'build')
      }
    }
  },
})
