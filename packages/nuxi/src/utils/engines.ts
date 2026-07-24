import process from 'node:process'
import { colors } from 'consola/utils'
import { satisfies } from 'verkit'

import { logger } from './logger'

export async function checkEngines() {
  const currentNode = process.versions.node
  const nodeRange = '>= 18.0.0'

  if (!satisfies(currentNode, nodeRange)) {
    logger.warn(
      `Current version of Node.js (${colors.cyan(currentNode)}) is unsupported and might cause issues.\n       Please upgrade to a compatible version ${colors.cyan(nodeRange)}.`,
    )
  }
}
