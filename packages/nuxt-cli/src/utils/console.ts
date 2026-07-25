import type { ConsolaReporter } from 'consola'

import process from 'node:process'

import { consola } from 'consola'

import { isBrokenPipe } from './errors'
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

function report(label: string, error: unknown) {
  if (isBrokenPipe(error)) {
    debug(`${label} ignoring broken pipe:`, error)
    return
  }
  consola.error(label, error)
}
