import type { TerminalBackground } from '../../utils/terminal-theme'

import { Buffer } from 'node:buffer'
import process from 'node:process'

import { isCI, isTest } from 'std-env'

import { debug } from '../../utils/logger'
import { rememberBackground, resolveBackground } from '../../utils/terminal-theme'

/** OSC 11: report the background colour. */
const QUERY = '\u001B]11;?\u0007'

/** `ESC ] 11 ; rgb:RRRR/GGGG/BBBB` followed by BEL or ST. */
// eslint-disable-next-line no-control-regex
const REPLY_RE = /\u001B\]11;rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\u0007|\u001B\\)?/i

/**
 * Nothing waits on the answer, so this is generous: a reply that arrives after
 * the wait is over would be read as keystrokes by whatever reads keys next.
 * Terminals that answer at all do so in a millisecond or two.
 */
const REPLY_TIMEOUT_MS = 250

/** Above this the background is treated as light. */
const LIGHT_THRESHOLD = 0.5

interface Stdin {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (raw: boolean) => unknown
  isPaused: () => boolean
  resume: () => unknown
  pause: () => unknown
  unshift: (chunk: Buffer) => unknown
  on: (event: 'data', listener: (chunk: Buffer) => void) => unknown
  off: (event: 'data', listener: (chunk: Buffer) => void) => unknown
}

export interface QueryBackgroundOptions {
  /** Reach the terminal without the panel or a capture swallowing the query. */
  write: (chunk: string) => void
  stdin?: Stdin
  stdout?: { isTTY?: boolean }
  env?: NodeJS.ProcessEnv
  timeout?: number
  ci?: boolean
  test?: boolean
}

let pending: Promise<TerminalBackground> | undefined
let release: (() => void) | undefined

/**
 * Give stdin back to a caller that needs it now, without waiting for a terminal
 * that may still be thinking. Returns once stdin is as the query found it.
 */
export function stopBackgroundQuery(): void {
  release?.()
}

/**
 * Ask the terminal what colour its background is, and remember the answer.
 *
 * Most terminals answer an OSC 11 query in a millisecond or two; some ignore it
 * and a few never had a reply to give. Nothing waits on the result: the panel
 * paints in colours that are safe either way and repaints if an answer arrives,
 * so a terminal that stays silent costs a 100ms timer and nothing else.
 */
export function queryBackground(options: QueryBackgroundOptions): Promise<TerminalBackground> {
  pending ??= resolve(options).then((background) => {
    if (background !== 'unknown') {
      rememberBackground(background)
    }
    return background
  })
  return pending
}

async function resolve(options: QueryBackgroundOptions): Promise<TerminalBackground> {
  const env = options.env ?? process.env
  const known = resolveBackground(env)
  if (known !== 'unknown' || !canAsk(options, env)) {
    return known
  }

  const stdin = options.stdin ?? process.stdin
  let buffer = ''
  try {
    buffer = await listen(stdin, options.timeout ?? REPLY_TIMEOUT_MS, () => options.write(QUERY))
  }
  catch (error) {
    debug('Could not ask the terminal for its background:', error)
    return 'unknown'
  }

  const reply = REPLY_RE.exec(buffer)
  // Anything typed while the terminal was thinking is put back for whoever
  // reads keys next, rather than being swallowed by the question.
  const typed = reply ? buffer.replace(reply[0], '') : buffer
  if (typed) {
    stdin.unshift(Buffer.from(typed, 'latin1'))
  }
  // Raw mode suppresses the terminal's own handling of Ctrl-C, so it has to be
  // passed on rather than left in the buffer for a handler that may never read.
  if (typed.includes('\u0003')) {
    process.emit('SIGINT' as 'disconnect')
  }
  if (!reply) {
    debug('The terminal did not report a background colour')
    return 'unknown'
  }

  return brightness(reply) > LIGHT_THRESHOLD ? 'light' : 'dark'
}

/**
 * Hold stdin in raw mode until the reply arrives or the wait is over, and give
 * it back exactly as it was found.
 *
 * Reading a reply means owning stdin, which whoever reads keys also needs. The
 * handover is {@link stopBackgroundQuery}, and it has to be synchronous: a
 * caller that asks for stdin back goes on to claim it in the same tick.
 */
function listen(stdin: Stdin, timeout: number, ask: () => void): Promise<string> {
  return new Promise<string>((resolve) => {
    const wasRaw = !!stdin.isRaw
    const wasPaused = stdin.isPaused()
    let buffer = ''
    let timer: NodeJS.Timeout
    let listening = true
    const onData = (chunk: Buffer) => {
      // Latin-1 keeps every byte addressable: a reply is ASCII, and anything
      // else here is a keystroke that has to survive being put back.
      buffer += chunk.toString('latin1')
      if (REPLY_RE.test(buffer) || buffer.includes('\u0003')) {
        finish()
      }
    }
    function finish(): void {
      if (!listening) {
        return
      }
      listening = false
      release = undefined
      clearTimeout(timer)
      stdin.off('data', onData)
      if (!wasRaw) {
        stdin.setRawMode?.(false)
      }
      if (wasPaused) {
        stdin.pause()
      }
      resolve(buffer)
    }
    release = finish
    timer = setTimeout(finish, timeout)
    timer.unref?.()
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.on('data', onData)
    ask()
  })
}

/**
 * Whether asking is worth the keystrokes it might interrupt.
 *
 * GNU screen rewrites the sequence and never passes the reply back; inside tmux
 * it is tmux that answers, which is the right answer for what is on screen.
 */
function canAsk(options: QueryBackgroundOptions, env: NodeJS.ProcessEnv): boolean {
  const stdout = options.stdout ?? process.stdout
  const stdin = options.stdin ?? process.stdin
  if (!stdout.isTTY || !stdin.isTTY || env.NO_COLOR || env.TERM === 'dumb') {
    return false
  }
  if (env.TERM?.startsWith('screen') && !env.TMUX) {
    return false
  }
  return !(options.ci ?? isCI) && !(options.test ?? isTest)
}

/**
 * How bright the reported colour looks, 0 to 1.
 *
 * Weighted for how the eye sees each channel but left gamma-encoded, which puts
 * the midpoint where a reader would put it: `#808080` reads as neither.
 */
function brightness([, ...channels]: RegExpExecArray): number {
  const [r, g, b] = channels.map((channel) => {
    const scale = 16 ** channel.length - 1
    return Number.parseInt(channel, 16) / scale
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
