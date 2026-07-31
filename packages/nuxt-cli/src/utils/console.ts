import type { ConsolaReporter } from 'consola'

import process from 'node:process'

import { consola } from 'consola'

import { isRemotePeerError } from './errors'
import { debug } from './logger'

// Filter out unwanted logs
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

  // Wrap all console logs with consola for better DX
  if (opts.dev) {
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

function report(label: string, error: unknown) {
  if (isRemotePeerError(error)) {
    debug(`${label} ignoring remote peer error:`, error)
    return
  }
  consola.error(label, error)
}
