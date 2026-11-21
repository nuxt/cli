import { Buffer } from 'node:buffer'
import process from 'node:process'

import { isCI } from 'std-env'

import { hasDisplayServer } from './display'
import { debug } from './logger'
import { writeDirect } from './stdout'
import { useTerminalHost } from './terminal-host'

/**
 * Terminals known to honour OSC 52. Support cannot be queried, and a terminal
 * that ignores the sequence stays silent, so anything unlisted is left alone.
 * Behind a multiplexer the real terminal is hidden, so the multiplexer is
 * trusted to relay the sequence (`set-clipboard on` in tmux).
 */
const OSC52_TERMS = /^(?:xterm-kitty|xterm-ghostty|foot|alacritty|wezterm|tmux|screen)/i
const OSC52_PROGRAMS = new Set(['iterm.app', 'wezterm', 'ghostty'])

export interface ClipboardOptions {
  /** Write to the terminal directly, for a caller that has taken over stdout. */
  write?: (chunk: string) => void
}

/**
 * Write `text` to the clipboard, resolving whether it succeeded. Uses the
 * platform clipboard where it can be reached, and otherwise asks the terminal
 * to set it with OSC 52, which also works over `ssh` and in containers.
 */
export async function writeClipboard(text: string, options: ClipboardOptions = {}): Promise<boolean> {
  if (await writeSystemClipboard(text)) {
    return true
  }
  // A terminal host diverts stdout into its own output, so the sequence would never arrive.
  const write = options.write ?? (useTerminalHost() ? undefined : writeDirect)
  if (!write || !canReachTerminal()) {
    return false
  }
  write(`\u001B]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`)
  return true
}

async function writeSystemClipboard(text: string): Promise<boolean> {
  if (!hasDisplayServer()) {
    return false
  }
  try {
    const { writeText } = await import('tinyclip')
    await writeText(text)
    return true
  }
  catch (error) {
    debug('Failed to write to the clipboard:', error)
    return false
  }
}

function canReachTerminal(): boolean {
  if (!process.stdout.isTTY || isCI) {
    return false
  }
  return OSC52_TERMS.test(process.env.TERM ?? '') || OSC52_PROGRAMS.has(process.env.TERM_PROGRAM?.toLowerCase() ?? '')
}
