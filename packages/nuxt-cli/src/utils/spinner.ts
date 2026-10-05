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
 * Without a TTY or in CI, each message is logged once as a plain line.
 */
export async function withSpinner<T>(message: string, fn: (spinner: Spinner) => Promise<T>, options: { done?: string } = {}): Promise<T> {
  let done = options.done
  const setDone = (text: string) => {
    done = text
  }
  const indicator = createSpinner()
  const run = async () => {
    indicator.start(message)
    try {
      const result = await fn({ update: text => indicator.message(text), done: setDone })
      indicator.stop(done)
      return result
    }
    catch (error) {
      // The message the work chose describes it succeeding; whoever threw
      // reports the failure itself.
      indicator.error()
      throw error
    }
    finally {
      restoreRawMode()
    }
  }
  return useTerminalHost() ? run() : withDirectStdout(run)
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
 * Without a TTY or in CI, each distinct message is logged once as a plain line.
 *
 * A host implies an interactive terminal, so cancellation stays with its key
 * handling: `onCancel` only fires on the clack path.
 */
export function createSpinner(options: { indicator?: 'dots' | 'timer', onCancel?: () => void } = {}): CliSpinner {
  const host = useTerminalHost()
  if (!host) {
    if (!process.stdout.isTTY || isCI) {
      return createPlainSpinner()
    }
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

function createPlainSpinner(): CliSpinner {
  let last: string | undefined
  const log = (text: string) => {
    if (text !== last) {
      last = text
      logger.info(`${text}...`)
    }
  }
  const finish = (report: (message: string) => void) => (message?: string) => {
    if (message) {
      report(message)
    }
    last = undefined
  }
  return {
    start: log,
    message: log,
    stop: finish(message => logger.success(message)),
    error: finish(message => logger.error(message)),
  }
}
