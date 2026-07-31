import process from 'node:process'
import { styleText } from 'node:util'
import { satisfies } from 'verkit'

import { logger } from './logger'

export async function checkEngines() {
  const currentNode = process.versions.node
  const nodeRange = '>= 18.0.0'

  if (!satisfies(currentNode, nodeRange)) {
    logger.warn(
      `Current version of Node.js (${styleText('cyan', currentNode)}) is unsupported and might cause issues.\n       Please upgrade to a compatible version ${styleText('cyan', nodeRange)}.`,
    )
  }
}
