import type { ConsolaInstance, ConsolaOptions, ConsolaReporter, FormatOptions, LogObject } from 'consola'

import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { format, styleText } from 'node:util'

import { consola } from 'consola'
import { resolveModulePath } from 'exsolve'
import { isCI } from 'std-env'

import { isRemotePeerError } from './errors'
import { debug, isEmittingCliLog, logger } from './logger'
import { tryResolveNuxt } from './resolve-nuxt'
import { holdScreen, isScreenHeld, takeUnseenOutput } from './screen'
import { withUserAttention } from './startup-clock'
import { isInteractiveSession, trackOutputSpacing, writeDirect } from './stdout'
import { MUTED } from './terminal-theme'

type FormattingReporter = ConsolaReporter & {
  formatArgs?: (args: unknown[], opts: FormatOptions) => string
}

let clackReporting = false

/**
 * Render consola logs as clack log lines, so the project's logs share the
 * gutter the CLI draws down the side of a command's output. Only takes effect
 * where that gutter is drawn. Returns a function that switches it off again.
 */
export function reportThroughClack(): () => void {
  if (!process.stdout.isTTY || isCI) {
    return () => {}
  }
  clackReporting = true
  return () => {
    clackReporting = false
  }
}

export function wrapReporter(reporter: FormattingReporter): ConsolaReporter {
  return ({
    log(logObj, ctx) {
      if (!logObj.args || !logObj.args.length) {
        return
      }
      const msg = logObj.args[0]
      if (typeof msg === 'string' && !process.env.DEBUG) {
        // Vite warns about sourcemaps in third-party packages, which users cannot fix.
        if (msg.startsWith('Sourcemap') && msg.includes('node_modules')) {
          return
        }
      }
      if (clackReporting && !isEmittingCliLog() && logObj.type !== 'box' && logObj.type !== 'trace') {
        const opts = { columns: process.stdout.columns || 0, ...ctx.options.formatOptions }
        const message = reporter.formatArgs
          ? reporter.formatArgs(logObj.args, opts)
          : format(...logObj.args)
        return logThroughClack(logObj, message)
      }
      return reporter.log(logObj, ctx)
    },
  }) satisfies ConsolaReporter
}

/** Bypasses `consola.wrapStd()`, which would hand each line back to consola. */
const directOutput = { write: writeDirect } as unknown as NodeJS.WriteStream

function logThroughClack(logObj: LogObject, message: string): void {
  message = message.replace(/`([^`\n]+)`/g, (_, code) => styleText('cyan', code))
  if (logObj.tag) {
    message = `${styleText(MUTED, `[${logObj.tag}]`)} ${message}`
  }
  const options = { output: directOutput }
  switch (logObj.type) {
    case 'fatal':
    case 'error':
    case 'fail':
      return logger.error(message, options)
    case 'warn':
      return logger.warn(message, options)
    case 'success':
    case 'ready':
      return logger.success(message, options)
    case 'info':
    case 'start':
      return logger.info(message, options)
    default:
      return logger.message(message, options)
  }
}

/** How Node opens a process warning, such as `(node:1234) DeprecationWarning: …`. */
const PROCESS_WARNING_RE = /^\(node:\d+\) /

/**
 * Log the process warnings Node prints through `console.error` as warnings.
 *
 * Call before `instance` wraps the console, which is when the wrapped
 * `console.error` is taken from it.
 */
export function routeProcessWarnings(instance: Pick<ConsolaInstance, 'error' | 'warn'>): void {
  const raw = instance.error.raw
  instance.error.raw = (...args) => {
    if (typeof args[0] === 'string' && PROCESS_WARNING_RE.test(args[0])) {
      return instance.warn.raw(...args)
    }
    return raw(...args)
  }
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
      routeProcessWarnings(projectConsola)
      interceptPrompts(projectConsola)
      // Logs from a separate instance would otherwise bypass the CLI's reporters.
      if (projectConsola !== consola) {
        projectConsola.setReporters([
          {
            log(logObj, ctx) {
              for (const reporter of consola.options.reporters) {
                reporter.log(logObj, ctx)
              }
            },
          },
        ])
      }
    }
  }
  catch (error) {
    debug('Could not configure the project consola:', error)
  }
}

export function setupGlobalConsole(opts: { dev?: boolean } = {}) {
  consola.options.formatOptions.date = false
  consola.options.reporters = consola.options.reporters.map(wrapReporter)
  routeProcessWarnings(consola)

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
 *
 * A question on screen owns the keyboard, so this does nothing while one is
 * up: its teardown puts the mode back.
 */
export function restoreRawMode(): void {
  if (isScreenHeld() || !process.stdin.isTTY) {
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
 * Guard a newly attached stdin reader against input it did not see typed: a
 * terminal buffers keystrokes while nothing is reading and hands the whole run
 * over in the first read once a reader resumes stdin. Anything arriving in a
 * later read was typed while the reader was listening.
 *
 * Returns whether the input being handled is part of that replay.
 */
export function guardReplayedInput(): () => boolean {
  let replaying = true
  const settled = setImmediate(() => {
    replaying = false
  })
  settled.unref?.()
  return () => replaying
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

/**
 * Ask a question with the terminal to itself: nothing else paints while it is
 * on screen, the keys typed belong to it, and raw mode is handed back before the
 * terminal returns to its owner.
 */
export function askQuestion<T>(question: () => Promise<T>): Promise<T> {
  return withUserAttention(() => withDirectStdout(async () => {
    const release = holdScreen()
    try {
      return await question()
    }
    finally {
      release()
      restoreRawMode()
    }
  }))
}

export function printJson(value: unknown): Promise<unknown> {
  return withDirectStdout(() => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`))
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
 * log and the keystroke meant for it taken as a shortcut. It is asked through
 * {@link askQuestion}, like the CLI's own prompts.
 *
 * Output printed in the same turn of the event loop as a question explains
 * what it is asking, so whatever of it was kept off the screen is shown above
 * the question.
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
    const leadIn = trimBlankLines(takeUnseenOutput())
    const answer = promptQueue.then(() => askQuestion(() => {
      if (leadIn) {
        writeDirect(`\n${leadIn}\n`)
      }
      return prompt(message, opts)
    }))
    promptQueue = answer.catch(() => {})
    return answer
  }) as PromptFn
  wrappedPrompts.add(wrapped)
  instance.options.prompt = wrapped
}

function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
}

/** What a question that could not be asked answers: whatever changes nothing. */
function declinedAnswer(opts: Parameters<PromptFn>[1] = {}) {
  return opts.type === 'confirm'
    ? false
    : undefined
}

function report(label: string, error: unknown) {
  if (isRemotePeerError(error)) {
    debug(`${label} ignoring remote peer error:`, error)
    return
  }
  consola.error(label, error)
}
