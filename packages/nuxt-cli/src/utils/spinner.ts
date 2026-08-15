import process from 'node:process'

import { spinner } from '@clack/prompts'
import { isCI } from 'std-env'

import { restoreRawMode, withDirectStdout } from './console'
import { logger } from './logger'

export interface Spinner {
  /** Replace the message shown beside the spinner. */
  update: (message: string) => void
  /** Set the line the spinner leaves behind, in place of `options.done`. */
  done: (message: string) => void
}

/**
 * Run `fn` with a spinner it can relabel as it goes, so work that takes a while
 * says what it is doing. Stopped with `options.done`, or silently, once `fn`
 * settles.
 *
 * Anywhere the frames would be noise rather than animation (CI, an agent, a piped
 * log) each message is logged as a plain line instead.
 */
export async function withSpinner<T>(message: string, fn: (spinner: Spinner) => Promise<T>, options: { done?: string } = {}): Promise<T> {
  let done = options.done
  const setDone = (text: string) => {
    done = text
  }

  if (!process.stdout.isTTY || isCI) {
    logger.info(`${message}...`)
    const result = await fn({ update: text => logger.info(`${text}...`), done: setDone })
    if (done) {
      logger.info(done)
    }
    return result
  }

  return withDirectStdout(async () => {
    const indicator = spinner()
    indicator.start(message)
    try {
      return await fn({ update: text => indicator.message(text), done: setDone })
    }
    finally {
      indicator.stop(done)
      restoreRawMode()
    }
  })
}
