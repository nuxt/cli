import type { CommandDef } from 'citty'
import type { TemplateName } from './utils/templates/names'

import { resolve } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { defineCommand } from 'citty'
import { provider } from 'std-env'

import { description, name, version } from '../package.json'
import { commands } from './commands'
import { cwdArgs, globalCwdArgs } from './commands/_shared'
import { LONG_RUNNING_COMMANDS, runCommand, setCurrentCommand } from './run'
import { setupGlobalConsole } from './utils/console'
import { debug, logger } from './utils/logger'
import { setupProxySupport } from './utils/network'
import { findInPath, withLocalBinPath } from './utils/path-env'
import { templateNames } from './utils/templates/names'
import { findUnknownFlags, replaceFlag, suggestFlags } from './utils/unknown-args'
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
    ...globalCwdArgs,
    command: {
      type: 'positional',
      required: false,
    },
  },
  subCommands: commands,
  async setup(ctx) {
    const command = ctx.args._[0]
    setCurrentCommand(command)
    setupGlobalConsole({ dev: command === 'dev' })

    if (command && command !== '_dev' && provider !== 'stackblitz') {
      // The engine check is awaited so its warning cannot land in the middle of
      // a prompt, but the update checks are left running: they reach the user
      // through a `process.exit` handler, and a slow or unreachable registry
      // must never hold up the command.
      await import('./utils/engines').then(({ checkEngines }) => checkEngines()).catch(err => logger.error(String(err)))
      void import('./utils/paths')
        .then(({ resolveProjectDir }) => scheduleUpdateNudge(resolveProjectDir(ctx.args), command))
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

    if (command && Object.hasOwn(commands, command)) {
      await warnUnknownFlags(command, ctx.rawArgs)
    }

    // allow running arbitrary commands if there's a locally registered binary with `nuxt-` prefix
    if (ctx.args.command && !Object.hasOwn(commands, ctx.args.command)) {
      const cwd = resolve(ctx.args.cwd || '.')
      const env = withLocalBinPath(cwd)
      // Resolved before spawning rather than after failing: Windows runs a bare
      // name through `cmd.exe`, which reports its own error instead of `ENOENT`,
      // so a missing binary would otherwise look like one that ran and failed.
      const binary = findInPath(`nuxt-${ctx.args.command}`, env)
      if (!binary) {
        return reportUnknownCommand(ctx.args.command, ctx.rawArgs)
      }
      const { x } = await import('tinyexec')
      // The resolved path is spawned rather than the bare name: `tinyexec` would
      // otherwise search `node_modules/.bin` relative to this process's directory,
      // which is not the directory the command was asked to run in.
      const result = await x(binary, ctx.rawArgs.slice(1), {
        nodeOptions: { stdio: 'inherit', cwd, env },
        nodePath: false,
        throwOnError: false,
      })
      process.exit(result.exitCode ?? 1)
    }
  },
})

/**
 * Report long flags the resolved command does not declare. Unknown flags are
 * otherwise parsed and silently ignored, so a misspelling looks like the flag
 * simply had no effect.
 */
async function warnUnknownFlags(command: string, rawArgs: string[]): Promise<void> {
  let def: CommandDef<any>
  try {
    def = await commands[command as keyof typeof commands]() as CommandDef<any>
    const subCommands = await resolveLazy(def.subCommands)
    const subCommand = rawArgs.slice(1).find(arg => !arg.startsWith('-'))
    if (subCommands && subCommand && Object.hasOwn(subCommands, subCommand)) {
      def = await resolveLazy(subCommands[subCommand]) as CommandDef<any>
    }
  }
  catch (err) {
    debug('Could not check arguments:', err)
    return
  }

  const argsDef = { ...cwdArgs, ...await resolveLazy(def.args) }
  const unknown = findUnknownFlags(argsDef, rawArgs.slice(1))
  if (unknown.flags.length === 0) {
    return
  }

  const suggestions = await suggestFlags(unknown)
  const { isInteractive } = await import('./utils/stdout')
  if (!isInteractive()) {
    for (const { flag, suggestion } of suggestions) {
      logger.warn(`Unknown option ${styleText('cyan', flag)}.${suggestion ? ` Did you mean ${styleText('cyan', suggestion)}?` : ''}`)
    }
    return
  }

  const { cancel, confirm, isCancel } = await import('@clack/prompts')
  const { restoreRawMode, withDirectStdout } = await import('./utils/console')
  for (const { flag, suggestion } of suggestions) {
    if (!suggestion) {
      logger.warn(`Unknown option ${styleText('cyan', flag)}.`)
      continue
    }
    // A negated unknown flag is matched against its bare name, so the offered
    // replacement has to restore the negation the user asked for.
    const replacement = flag.startsWith('--no-') && !suggestion.startsWith('--no-')
      ? `--no-${suggestion.slice(2)}`
      : suggestion
    logger.warn(`Unknown option ${styleText('cyan', flag)}.`)
    const answer = await withDirectStdout(() => confirm({ message: `Use ${styleText('cyan', replacement)} instead?`, initialValue: true }))
    restoreRawMode()
    // Ctrl-C at the prompt must abort, not fall through to running the command
    // with the flag the user was told is unknown.
    if (isCancel(answer)) {
      cancel('Aborted.')
      process.exit(130)
    }
    if (answer) {
      replaceFlag(rawArgs, flag, replacement)
    }
  }
}

function resolveLazy<T>(value: T | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  return Promise.resolve(typeof value === 'function' ? (value as () => T | Promise<T>)() : value)
}

/**
 * Report a command that neither the CLI nor a local `nuxt-` binary provides.
 *
 * With a confident suggestion this is the whole error, since a full help dump
 * buries the one line the user needs; interactively, the suggestion is offered
 * to run directly. Otherwise nothing is printed and citty falls back to
 * showing usage.
 */
async function reportUnknownCommand(command: string, rawArgs: string[]): Promise<void> {
  const { suggestCommand } = await import('./utils/suggest-command')
  const names = Object.keys(commands).filter(name => !name.startsWith('_'))
  const suggestion = await suggestCommand(command, names)
  if (!suggestion) {
    return
  }

  const { isInteractive } = await import('./utils/stdout')
  if (isInteractive()) {
    logger.warn(`Unknown command ${styleText('cyan', command)}.`)
    const { confirm, isCancel } = await import('@clack/prompts')
    const { restoreRawMode, withDirectStdout } = await import('./utils/console')
    const answer = await withDirectStdout(() => confirm({ message: `Run ${styleText('cyan', `nuxt ${suggestion}`)} instead?`, initialValue: true }))
    restoreRawMode()

    if (isCancel(answer)) {
      process.exit(130)
    }

    if (answer) {
      const index = rawArgs.indexOf(command)
      const argv = index === -1 ? rawArgs : rawArgs.toSpliced(index, 1)
      setCurrentCommand(suggestion)
      await runCommand(suggestion, argv).catch((err) => {
        console.error(err.message)
        process.exit(1)
      })
      if (LONG_RUNNING_COMMANDS.has(suggestion)) {
        // Keep the process serving; exiting here, or returning to citty (which
        // would fail to resolve the unknown subcommand), would tear it down.
        await new Promise(() => {})
      }
      process.exit(0)
    }
  }

  logger.error(`Unknown command ${styleText('cyan', command)}. Did you mean ${styleText('cyan', `nuxt ${suggestion}`)}?`)
  logger.info(`Run ${styleText('cyan', 'nuxt --help')} to see all commands.`)
  process.exit(1)
}

export const main = _main as CommandDef<any>
