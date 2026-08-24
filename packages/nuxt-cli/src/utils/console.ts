import type { ConsolaOptions, ConsolaReporter } from 'consola'

import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { consola } from 'consola'
import { resolveModulePath } from 'exsolve'

import { isRemotePeerError } from './errors'
import { tryResolveNuxt } from './kit'
import { debug } from './logger'
import { withStartupClockPaused } from './startup-clock'
import { isInteractiveSession, trackOutputSpacing } from './stdout'
import { useTerminalHost } from './terminal-host'

// TODO: Use better API from consola for intercepting logs
function wrapReporter(reporter: ConsolaReporter) {
  return ({
    log(logObj, ctx) {
      if (!logObj.args || !logObj.args.length) {
        return
      }
      const msg = logObj.args[0]
      if (typeof msg === 'string' && !process.env.DEBUG) {
        // TODO: resolve upstream in Vite
        // Hide sourcemap warnings related to node_modules
        if (msg.startsWith('Sourcemap') && msg.includes('node_modules')) {
          return
        }
      }
      return reporter.log(logObj, ctx)
    },
  }) satisfies ConsolaReporter
}

export async function configureProjectConsola(rootDir: string): Promise<void> {
  try {
    const path = resolveModulePath('consola', { from: tryResolveNuxt(rootDir) || rootDir, try: true })
    if (!path) {
      return
    }
    const mod = await import(pathToFileURL(path).href) as { consola?: typeof consola, default?: typeof consola }
    const projectConsola = mod.consola ?? mod.default
    if (projectConsola) {
      projectConsola.options.formatOptions.date = false
      interceptPrompts(projectConsola)
    }
  }
  catch (error) {
    debug('Could not configure the project consola:', error)
  }
}

export function setupGlobalConsole(opts: { dev?: boolean } = {}) {
  consola.options.formatOptions.date = false
  consola.options.reporters = consola.options.reporters.map(wrapReporter)

  if (opts.dev) {
    trackOutputSpacing()
    consola.wrapAll()
    interceptPrompts(consola)
  }
  else {
    consola.wrapConsole()
  }

  process.on('unhandledRejection', err => report('[unhandledRejection]', err))

  process.on('uncaughtException', err => report('[uncaughtException]', err))
}

/**
 * Take `process.stdin` out of raw mode if something left it there.
 *
 * `@clack/core` skips restoring raw mode on Windows when a spinner or progress
 * bar stops (https://github.com/bombshell-dev/clack/blob/main/packages/core/src/utils/index.ts).
 * While stdin is raw the console no longer turns Ctrl-C into `SIGINT`, and
 * `Enter` arrives as a bare `\r`, which `readline` never treats as end of line,
 * so a long-lived command such as `nuxt dev` is left with dead Ctrl-C and dead
 * keyboard shortcuts.
 */
export function restoreRawMode(): void {
  if (!process.stdin.isTTY) {
    return
  }
  if (process.stdin.isPaused()) {
    process.stdin.resume()
  }
  if (process.stdin.isRaw) {
    process.stdin.setRawMode(false)
  }
}

/**
 * Give up `process.stdin` after a prompt in a command that is about to finish.
 *
 * A resumed stdin is an active handle, so a one-shot command would otherwise sit
 * there with nothing left to do until the terminal closes.
 */
export function releaseStdin(): void {
  restoreRawMode()
  if (!process.stdin.isTTY) {
    return
  }
  process.stdin.pause()
  process.stdin.unref()
}

/**
 * Run `fn` with `process.stdout` and `process.stderr` writing straight to the
 * terminal again.
 *
 * `consola.wrapAll()` swaps `stream.write` for a call that trims each chunk and
 * logs it as a line of its own. That is fine for stray `console.log`s, but it
 * breaks anything that positions the cursor itself: clack redraws a frame with
 * several small writes (a cursor move, an erase, the new lines) and every one of
 * them would come back with a newline attached, so each keypress pushes the
 * prompt further down the screen.
 */
export async function withDirectStdout<T>(fn: () => T | Promise<T>): Promise<T> {
  const wrapped = process.stdout as typeof process.stdout & { __write?: typeof process.stdout.write }
  if (!wrapped.__write || wrapped.write === wrapped.__write) {
    return fn()
  }
  consola.restoreStd()
  try {
    return await fn()
  }
  finally {
    consola.wrapStd()
  }
}

type PromptFn = NonNullable<ConsolaOptions['prompt']>

/** Resolves once the prompt currently on screen, if any, has been answered. */
let promptQueue: Promise<unknown> = Promise.resolve()

const wrappedPrompts = new WeakSet<PromptFn>()

/**
 * Ask `instance`'s questions on a terminal they can be read and answered on.
 *
 * A question raised from inside the dev server, such as a module asking to
 * install itself, arrives long after the CLI's own prompts are done with the
 * terminal: the interactive UI is folding output away into its log view and
 * holding stdin for its shortcuts, so the question would be filed away as a
 * log and the keystroke meant for it taken as a shortcut. When a terminal
 * host is published the question is asked inside its `withTerminal`, and
 * through {@link withDirectStdout} like the CLI's own prompts either way.
 *
 * Prompts are serialised, since two of them redrawing over each other can be
 * neither read nor answered.
 */
export function interceptPrompts(instance: { options: { prompt?: PromptFn } }): void {
  const prompt = instance.options.prompt
  if (!prompt || wrappedPrompts.has(prompt)) {
    return
  }
  const wrapped = ((message: string, opts: Parameters<PromptFn>[1] = {}) => {
    // A dev fork's stdin is `/dev/null`, and clack would wait on it forever.
    if (!isInteractiveSession()) {
      debug(`Not asking, with no terminal to answer on: ${message}`)
      return Promise.resolve(declinedAnswer(opts))
    }
    const answer = promptQueue.then(() => withStartupClockPaused(() => {
      const ask = () => withDirectStdout(() => prompt(message, opts))
      const host = useTerminalHost()
      return host ? host.withTerminal(ask) : ask()
    }))
    promptQueue = answer.catch(() => {})
    return answer
  }) as PromptFn
  wrappedPrompts.add(wrapped)
  instance.options.prompt = wrapped
}

/** What a question that could not be asked answers: whatever changes nothing. */
function declinedAnswer(opts: Parameters<PromptFn>[1] = {}) {
  return opts.type === 'confirm' ? false : undefined
}

function report(label: string, error: unknown) {
  if (isRemotePeerError(error)) {
    debug(`${label} ignoring remote peer error:`, error)
    return
  }
  consola.error(label, error)
}
