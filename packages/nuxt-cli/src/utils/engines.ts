import process from 'node:process'
import { styleText } from 'node:util'
import { satisfies } from 'verkit'

import { engines } from '../../package.json'
import { logger } from './logger'

export async function checkEngines() {
  const currentNode = process.versions.node

  if (!satisfies(currentNode, engines.node)) {
    logger.warn(
      `Current version of Node.js (${styleText('cyan', currentNode)}) is unsupported and might cause issues.\n       Please upgrade to a compatible version ${styleText('cyan', engines.node)}.`,
    )
  }
}
