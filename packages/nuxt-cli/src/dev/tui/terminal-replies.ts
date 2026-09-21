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
 * A CSI report whose final byte has not arrived yet. A lone `ESC` is
 * deliberately not one of these: it is also the Escape key, and holding it back
 * on the chance that a report follows would cost more than it saves.
 */
// eslint-disable-next-line no-control-regex
const PARTIAL_CSI_RE = /^\u001B\[[\d;?]*$/

/** How long an unterminated reply may swallow keys before it is dropped. */
const REPLY_TIMEOUT_MS = 200

/** Longest tail of an unfinished reply held while the rest is awaited. */
const MAX_PENDING = 64

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
export function filterTerminalReplies(stdin: NodeJS.ReadableStream): ReplyFilter {
  let replying = false
  let pending = ''
  let timer: NodeJS.Timeout | undefined

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
   * account for was typed, so it is put back to be read as keys of its own.
   */
  function endReply(buffered: string, length: number): void {
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
      stopReplying()
      stdin.off('data', onData)
    },
  }
}
