import type { ConsolaReporter } from 'consola'

import process from 'node:process'

import { consola } from 'consola'

import { isRemotePeerError } from './errors'
import { debug } from './logger'
import { trackOutputSpacing } from './stdout'

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

export function setupGlobalConsole(opts: { dev?: boolean } = {}) {
  consola.options.formatOptions.date = false
  consola.options.reporters = consola.options.reporters.map(wrapReporter)

  if (opts.dev) {
    trackOutputSpacing()
    consola.wrapAll()
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

function report(label: string, error: unknown) {
  if (isRemotePeerError(error)) {
    debug(`${label} ignoring remote peer error:`, error)
    return
  }
  consola.error(label, error)
}
