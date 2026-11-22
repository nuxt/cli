import { Buffer } from 'node:buffer'

/** Introduces an OSC, DCS, APC or PM string, which runs until its terminator. */
// eslint-disable-next-line no-control-regex
const STRING_REPLY_RE = /^\u001B[\]P^_X]/

/** Ends an OSC, DCS, APC or PM string. */
// eslint-disable-next-line no-control-regex
const STRING_TERMINATOR_RE = /\u0007|\u001B\\/

/**
 * A whole CSI report: cursor position, device attributes, window size. Narrow,
 * because cursor keys and `alt`ed letters are escape sequences too.
 */
// eslint-disable-next-line no-control-regex
const CSI_REPLY_RE = /^\u001B\[[\d;?]*[Rcnty]/

/**
 * A mouse report in SGR encoding: button, column, row, then `M` pressed or `m`
 * released. Matched anywhere, since reports queue up behind typing and behind
 * each other.
 */
// eslint-disable-next-line no-control-regex
const MOUSE_REPORT_RE = /\u001B\[<(\d+);(\d+);(\d+)(M)/gi

/**
 * A CSI report whose final byte has not arrived yet. A lone `ESC` is
 * deliberately not one of these: it is also the Escape key, and holding it back
 * on the chance that a report follows would cost more than it saves.
 */
// eslint-disable-next-line no-control-regex
const PARTIAL_CSI_RE = /^\u001B\[<?[\d;?]*$/

/** How long an unterminated reply may swallow keys before it is dropped. */
const REPLY_TIMEOUT_MS = 200

/** Longest tail of an unfinished reply held while the rest is awaited. */
const MAX_PENDING = 64

/** Report presses, releases and the wheel, in SGR encoding. */
export const ENABLE_MOUSE = '\u001B[?1000h\u001B[?1006h'
export const DISABLE_MOUSE = '\u001B[?1006l\u001B[?1000l'

export const LEFT_BUTTON = 0
export const WHEEL_UP = 64
export const WHEEL_DOWN = 65

/** Zero-based: row 0 is the top line of the screen. */
export interface MouseReport {
  button: number
  pressed: boolean
  row: number
  column: number
}

export interface ReplyFilter {
  /** Whether the chunk being delivered is the terminal answering, not typing. */
  isReplying: () => boolean
  stop: () => void
}

/**
 * Watch a stream for answers from the terminal, so a key reader can tell them
 * apart from typing: a background colour reply arrives as `ESC ] 1 1 ; r g b : …`,
 * every character of which is also a shortcut.
 *
 * Attach before the `keypress` listener, so each chunk is classified by the time
 * `readline` turns it into keys.
 */
export function filterTerminalReplies(stdin: NodeJS.ReadableStream, onMouse?: (report: MouseReport) => void): ReplyFilter {
  let replying = false
  let pending = ''
  let timer: NodeJS.Timeout | undefined
  let stopped = false

  function stopReplying(): void {
    replying = false
    pending = ''
    clearTimeout(timer)
    timer = undefined
  }

  /**
   * Finish a reply that ends `length` characters into what has been buffered.
   *
   * The whole chunk is suppressed, since `readline` has not turned it into keys
   * yet and there is no way to drop only part of it. Anything the reply did not
   * account for was typed, so it is put back to be read as keys of its own,
   * ahead of the mouse reports that came `after` it and a report `cut` short.
   */
  function endReply(buffered: string, length: number, after: MouseReport[] = [], cut = ''): void {
    const typed = buffered.slice(length)
    clearTimeout(timer)
    timer = undefined
    pending = ''
    // After this chunk, so the reply is still suppressed while `readline` reads
    // it, and what was typed is read back with the filter already clear.
    setImmediate(() => {
      stopReplying()
      if (typed) {
        stdin.unshift(Buffer.from(typed, 'latin1'))
      }
      if (stopped) {
        return
      }
      for (const report of after) {
        onMouse?.(report)
      }
      if (cut) {
        replying = true
        awaitRest(cut)
      }
    })
  }

  /** Wait for the rest of a reply, without waiting on it forever. */
  function awaitRest(buffered: string): void {
    if (buffered.length > MAX_PENDING) {
      return stopReplying()
    }
    pending = buffered
    // Dated from the first piece, so a dribble of them cannot hold the keyboard.
    timer ??= setTimeout(stopReplying, REPLY_TIMEOUT_MS)
    timer.unref?.()
  }

  const onData = (chunk: Buffer) => {
    // A reply can be split anywhere, so the unresolved tail is carried over and
    // matched together with what follows it.
    const buffered = pending + chunk.toString('latin1')

    const after: MouseReport[] = []
    let typed = ''
    let end = 0
    for (const match of buffered.matchAll(MOUSE_REPORT_RE)) {
      const [, button, column, row, state] = match
      const report = {
        button: Number(button),
        pressed: state === 'M',
        column: Number(column) - 1,
        row: Number(row) - 1,
      }
      typed += buffered.slice(end, match.index)
      end = match.index + match[0].length
      // Typing is only read once this chunk is done, and may move what a later click lands on.
      if (typed) {
        after.push(report)
      }
      else {
        onMouse?.(report)
      }
    }
    if (end) {
      const rest = buffered.slice(end)
      replying = true
      if (!PARTIAL_CSI_RE.test(rest)) {
        return endReply(typed + rest, 0, after)
      }
      return typed
        ? endReply(typed, 0, after, rest)
        : awaitRest(rest)
    }
    const csi = CSI_REPLY_RE.exec(buffered)
    if (csi) {
      replying = true
      return endReply(buffered, csi[0].length)
    }
    if (STRING_REPLY_RE.test(buffered)) {
      replying = true
      const terminator = STRING_TERMINATOR_RE.exec(buffered)
      return terminator
        ? endReply(buffered, terminator.index + terminator[0].length)
        : awaitRest(buffered)
    }
    if (PARTIAL_CSI_RE.test(buffered)) {
      replying = true
      return awaitRest(buffered)
    }
    stopReplying()
  }
  stdin.on('data', onData)

  return {
    isReplying: () => replying,
    stop: () => {
      stopped = true
      stopReplying()
      stdin.off('data', onData)
    },
  }
}
