import { logger } from './logger'

export const overrideEnv = (targetEnv: string) => {
  const currentEnv = process.env.NODE_ENV
  if (currentEnv && currentEnv !== targetEnv) {
    logger.warn(
      `Changing \`NODE_ENV\` from \`${currentEnv}\` to \`${targetEnv}\`, to avoid unintended behavior.`,
    )
  }

  process.env.NODE_ENV = targetEnv
}
