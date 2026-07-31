import process from 'node:process'
import { styleText } from 'node:util'

import { logger } from './logger'

export function overrideEnv(targetEnv: string) {
  const currentEnv = process.env.NODE_ENV
  if (currentEnv && currentEnv !== targetEnv) {
    logger.warn(
      `Changing ${styleText('cyan', 'NODE_ENV')} from ${styleText('cyan', currentEnv)} to ${styleText('cyan', targetEnv)}, to avoid unintended behavior.`,
    )
  }

  process.env.NODE_ENV = targetEnv
}
