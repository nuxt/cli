import { styleText } from 'node:util'
import { log, S_INFO } from '@clack/prompts'
import { createDebug } from 'obug'

import { blankLineBefore, writeDirect } from './stdout'

type LoggerImpl = Pick<typeof log, 'info' | 'warn' | 'error' | 'success' | 'step' | 'message'>

let impl: LoggerImpl = log
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
  impl = next ?? log
}

export const logger: LoggerImpl = {
  info: message => emit(() => impl.info(message)),
  warn: message => emit(() => impl.warn(message)),
  error: message => emit(() => impl.error(message)),
  success: message => emit(() => impl.success(message)),
  step: message => emit(() => impl.step(message)),
  message: (message, options) => emit(() => impl.message(message, options)),
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
