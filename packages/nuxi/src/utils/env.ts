import process from 'node:process'
import colors from 'picocolors'

import { logger } from './logger'

export function overrideEnv(targetEnv: string) {
  const currentEnv = process.env.NODE_ENV
  if (currentEnv && currentEnv !== targetEnv) {
    logger.warn(
      `Changing ${colors.cyan('NODE_ENV')} from ${colors.cyan(currentEnv)} to ${colors.cyan(targetEnv)}, to avoid unintended behavior.`,
    )
  }

  process.env.NODE_ENV = targetEnv
}
