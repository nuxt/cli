import process from 'node:process'
import { styleText } from 'node:util'
import { intro as clackIntro, outro as clackOutro, log, S_ERROR, S_INFO, S_STEP_SUBMIT, S_SUCCESS, S_WARN } from '@clack/prompts'
import { createDebug } from 'obug'
import { isCI } from 'std-env'

import { blankLineBefore, writeDirect } from './stdout'

type LoggerImpl = Pick<typeof log, 'info' | 'warn' | 'error' | 'success' | 'step' | 'message'>

type LineColor = 'blue' | 'yellow' | 'red' | 'green'

/**
 * A log line with no clack framing: the `│` gutter connects one prompt to the
 * next on screen, and in a redirected log it is a bare column of punctuation
 * between every line of real output.
 */
function plainLine(symbol: string, color: LineColor, message?: string): void {
  const body = String(message ?? '').replace(/\n/g, '\n  ')
  writeDirect(`${styleText(color, symbol)} ${body}\n`)
}

const plain: LoggerImpl = {
  info: message => plainLine(S_INFO, 'blue', message),
  warn: message => plainLine(S_WARN, 'yellow', message),
  error: message => plainLine(S_ERROR, 'red', message),
  success: message => plainLine(S_SUCCESS, 'green', message),
  step: message => plainLine(S_STEP_SUBMIT, 'green', message),
  message: message => writeDirect(`${String(message ?? '')}\n`),
}

function defaultImpl(): LoggerImpl {
  return !process.stdout.isTTY || isCI ? plain : log
}

let impl: LoggerImpl | undefined
let depth = 0

/**
 * Whether the CLI itself is emitting a log right now.
 *
 * The app, its build tools and the CLI all log through consola, so a reporter
 * cannot otherwise tell whose message it is holding. Checked synchronously,
 * while the call is on the stack.
 */
export function isEmittingCliLog(): boolean {
  return depth > 0
}

function emit<T>(write: () => T): T {
  depth++
  try {
    return write()
  }
  finally {
    depth--
  }
}

/**
 * Swap the presentation of CLI logs, or restore the default when called with
 * nothing. The interactive dev UI uses this to drop clack's connecting `│`
 * guideline, which reads as a stray artefact next to a persistent footer.
 */
export function setLoggerImpl(next?: LoggerImpl): void {
  impl = next
}

export const logger: LoggerImpl = {
  info: message => emit(() => (impl ?? defaultImpl()).info(message)),
  warn: message => emit(() => (impl ?? defaultImpl()).warn(message)),
  error: message => emit(() => (impl ?? defaultImpl()).error(message)),
  success: message => emit(() => (impl ?? defaultImpl()).success(message)),
  step: message => emit(() => (impl ?? defaultImpl()).step(message)),
  message: (message, options) => emit(() => (impl ?? defaultImpl()).message(message, options)),
}

/**
 * Open a command's output. Falls back to a bare headline where clack's opening
 * corner would only introduce a gutter nothing draws against.
 */
export function intro(message: string): void {
  if (!process.stdout.isTTY || isCI) {
    writeDirect(`${message}\n`)
    return
  }
  clackIntro(message)
}

/** {@link intro}, for the line a command finishes on. */
export function outro(message: string): void {
  if (!process.stdout.isTTY || isCI) {
    writeDirect(`${styleText('green', S_SUCCESS)} ${message}\n`)
    return
  }
  clackOutro(message)
}

export const debug = createDebug('nuxi')

/**
 * Write a standalone info line, optionally followed by an indented instruction
 * on a line of its own so the user can select whatever they need to type.
 *
 * Unlike {@link logger}`.info` this leaves no connecting `│` and aligns the text
 * two columns in, which is what the standalone notices at the end of a command
 * share.
 *
 * Commands leave the cursor in different places (`init` ends on the blank line
 * after clack's outro, `dev` and `build` on the line after their last log), so
 * the leading gap is measured rather than assumed.
 */
export function writeNotice(headline: string, instruction?: string): void {
  const body = instruction ? `${headline}\n  ${instruction}\n` : `${headline}\n`
  writeDirect(`${blankLineBefore()}${styleText('blue', S_INFO)} ${body}`)
}
