import type { CommandDef } from 'citty'
import type { TemplateName } from './utils/templates/names'

import { resolve } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { defineCommand } from 'citty'
import { provider } from 'std-env'

import { description, name, version } from '../package.json'
import { commands } from './commands'
import { cwdArgs } from './commands/_shared'
import { runCommand, setCurrentCommand } from './run'
import { normaliseCwdArg } from './utils/args'
import { setupGlobalConsole } from './utils/console'
import { checkEngines } from './utils/engines'
import { debug, logger } from './utils/logger'
import { setupProxySupport } from './utils/network'
import { withLocalBinPath } from './utils/path-env'
import { resolveProjectDir } from './utils/paths'
import { templateNames } from './utils/templates/names'
import { scheduleUpdateNudge } from './utils/update-lazy'

// Node.js only reads `NODE_USE_ENV_PROXY` during bootstrap, so this cannot make
// the current process proxy-aware; it propagates the setting to child processes
// (package manager installs, dev server) and records the state for error hints.
setupProxySupport()

const _main = defineCommand({
  meta: {
    name: name.endsWith('nightly') ? name : 'nuxt',
    version,
    description,
  },
  args: {
    ...cwdArgs,
    command: {
      type: 'positional',
      required: false,
    },
  },
  subCommands: commands,
  async setup(ctx) {
    normaliseCwdArg(ctx.rawArgs)

    const command = ctx.args._[0]
    setCurrentCommand(command)
    setupGlobalConsole({ dev: command === 'dev' })

    if (command !== '_dev' && provider !== 'stackblitz') {
      // The engine check is awaited so its warning cannot land in the middle of
      // a prompt, but the update checks are left running: they reach the user
      // through a `process.exit` handler, and a slow or unreachable registry
      // must never hold up the command.
      await checkEngines().catch(err => logger.error(String(err)))
      void scheduleUpdateNudge(resolveProjectDir(ctx.args), command)
        .catch(err => debug('Failed to check for updates:', err))
    }

    if (command === 'add' && ctx.rawArgs[1] && templateNames.includes(ctx.rawArgs[1] as TemplateName)) {
      logger.warn(`${styleText('yellow', 'Deprecated:')} Using ${styleText('cyan', 'nuxt add <template> <name>')} is deprecated.`)
      logger.info(`Please use ${styleText('cyan', 'nuxt add-template <template> <name>')} instead.`)
      await runCommand('add-template', [...ctx.rawArgs.slice(1)]).catch((err) => {
        console.error(err.message)
        process.exit(1)
      })
      process.exit(0)
    }

    // allow running arbitrary commands if there's a locally registered binary with `nuxt-` prefix
    if (ctx.args.command && !Object.hasOwn(commands, ctx.args.command)) {
      const cwd = resolve(ctx.args.cwd)
      try {
        const { x } = await import('tinyexec')
        const result = await x(`nuxt-${ctx.args.command}`, ctx.rawArgs.slice(1), {
          nodeOptions: {
            stdio: 'inherit',
            cwd,
            env: withLocalBinPath(cwd),
          },
          throwOnError: false,
        })
        process.exit(result.exitCode ?? 1)
      }
      catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return
        }
        throw err
      }
    }
  },
})

export const main = _main as CommandDef<any>
