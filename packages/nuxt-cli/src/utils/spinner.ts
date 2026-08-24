import type { TerminalTask } from './terminal-host'

import process from 'node:process'

import { spinner } from '@clack/prompts'
import { isCI } from 'std-env'

import { restoreRawMode, withDirectStdout } from './console'
import { logger } from './logger'
import { useTerminalHost } from './terminal-host'

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

  const host = useTerminalHost()
  if (host) {
    const task = host.startTask(message)
    try {
      return await fn({ update: text => task.update(text), done: setDone })
    }
    finally {
      task.stop(done, 'success')
    }
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

export interface CliSpinner {
  start: (message: string) => void
  message: (text: string) => void
  stop: (message?: string) => void
  error: (message?: string) => void
}

/**
 * A clack spinner, unless something else owns the terminal.
 *
 * `module add` also runs inside `nuxt dev` (a module asking to install itself
 * imports the project's `@nuxt/cli` and runs it in-process), where a spinner
 * animating frames into the stream would be captured into the dev UI's log
 * history one frame at a time. With a terminal host published, the work is
 * reported as a task on the host's own status line instead.
 *
 * A host implies an interactive terminal, so cancellation stays with its key
 * handling: `onCancel` only fires on the clack path.
 */
export function createSpinner(options: { indicator?: 'dots' | 'timer', onCancel?: () => void } = {}): CliSpinner {
  const host = useTerminalHost()
  if (!host) {
    return spinner(options)
  }
  let task: TerminalTask | undefined
  return {
    start: message => (task ??= host.startTask(message)),
    message: text => task?.update(text),
    stop: (message) => {
      task?.stop(message, 'success')
      task = undefined
    },
    error: (message) => {
      task?.stop(message, 'failure')
      task = undefined
    },
  }
}
