import { styleText } from 'node:util'
import { log, S_INFO } from '@clack/prompts'
import { createDebug } from 'obug'

import { blankLineBefore, writeDirect } from './stdout'

export const logger = log
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
