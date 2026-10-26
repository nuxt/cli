import type { WriteTypesOptions } from './utils/write-types'

import process from 'node:process'

import { setupGlobalConsole } from './utils/console'
import { asActionableError } from './utils/errors'
import { writeTypes } from './utils/write-types'

setupGlobalConsole()

writeTypes(JSON.parse(process.argv[2]!) as WriteTypesOptions)
  .catch((error) => {
    console.error(asActionableError(error), '\n')
    process.exitCode = 1
  })
  // Handles left open after `nuxt.close()` must not keep the parent waiting.
  .finally(() => process.exit())
