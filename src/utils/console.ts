import { consola } from 'consola'
import type { ConsolaReporter } from 'consola'

// Filter out unwanted logs
// TODO: Use better API from consola for intercepting logs
const wrapReporter = (reporter: ConsolaReporter) =>
  ({
    log(logObj, ctx) {
      if (!logObj.args || !logObj.args.length) {
        return
      }
      const msg = logObj.args[0]
      if (typeof msg === 'string' && !process.env.DEBUG) {
        // Hide vue-router 404 warnings
        if (
          msg.startsWith(
            '[Vue Router warn]: No match found for location with path',
          )
        ) {
          return
        }
        // Suppress warning about native Node.js fetch
        if (
          msg.includes(
            'ExperimentalWarning: The Fetch API is an experimental feature',
          )
        ) {
          return
        }
        // TODO: resolve upstream in Vite
        // Hide sourcemap warnings related to node_modules
        if (msg.startsWith('Sourcemap') && msg.includes('node_modules')) {
          return
        }
      }
      return reporter.log(logObj, ctx)
    },
  }) satisfies ConsolaReporter

export function setupGlobalConsole(opts: { dev?: boolean } = {}) {
  consola.options.reporters = consola.options.reporters.map(wrapReporter)

  // Wrap all console logs with consola for better DX
  if (opts.dev) {
    consola.wrapAll()
  }
  else {
    consola.wrapConsole()
  }

  process.on('unhandledRejection', err =>
    consola.error('[unhandledRejection]', err),
  )

  process.on('uncaughtException', err =>
    consola.error('[uncaughtException]', err),
  )
}
