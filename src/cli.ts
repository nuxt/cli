import type { ConsolaReporter } from 'consola'
import consola from 'consola'
import { checkEngines } from './utils/engines'
import { checkForUpdates } from './utils/update'
import { defineCommand, runMain } from 'citty'
import { commands } from './commands'

export const command = defineCommand({
  meta: {
    name: 'nuxt',
    description: 'Nuxt CLI',
    version: 'dev',
  },
  subCommands: commands,
  run() {
    // Check Node.js version in background
    setTimeout(() => {
      checkEngines().catch(() => {})
    }, 100)

    // Check for CLI updates in the background
    setTimeout(() => {
      checkForUpdates().catch(() => {})
    }, 100)

    // Wrap all console logs with consola for better DX
    consola.wrapAll()

    // Filter out unwanted logs
    // TODO: Use better API from consola for intercepting logs
    const wrapReporter = (reporter: ConsolaReporter) =>
      <ConsolaReporter>{
        log(logObj, ctx) {
          if (!logObj.args || !logObj.args.length) {
            return
          }
          const msg = logObj.args[0]
          if (typeof msg === 'string' && !process.env.DEBUG) {
            // Hide vue-router 404 warnings
            if (
              msg.startsWith(
                '[Vue Router warn]: No match found for location with path'
              )
            ) {
              return
            }
            // Hide sourcemap warnings related to node_modules
            if (msg.startsWith('Sourcemap') && msg.includes('node_modules')) {
              return
            }
          }
          return reporter.log(logObj, ctx)
        },
      }
    // @ts-expect-error
    consola._reporters = consola._reporters.map(wrapReporter)

    process.on('unhandledRejection', (err) =>
      consola.error('[unhandledRejection]', err)
    )
    process.on('uncaughtException', (err) =>
      consola.error('[uncaughtException]', err)
    )
  },
})

export const main = () => runMain(command)
