import process from 'node:process'
import { styleText } from 'node:util'
import { defineCommand } from 'citty'

import { getCreateCommand } from '../utils/headless'
import { logger } from '../utils/logger'
import { commandMeta } from './meta'

export default defineCommand({
  meta: commandMeta.init,
  run(ctx) {
    const command = [getCreateCommand(), ...ctx.rawArgs].join(' ')
    logger.info(`Project scaffolding now lives in ${styleText('cyan', 'create-nuxt')}.`)
    logger.info(`Run ${styleText('cyan', command)} instead.`)
    process.exit(1)
  },
})
