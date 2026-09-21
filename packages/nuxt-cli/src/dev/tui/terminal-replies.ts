import type { Buffer } from 'node:buffer'

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

  /** This chunk's keys have not been emitted yet; the next chunk is typing. */
  function endAfterThisChunk(): void {
    clearTimeout(timer)
    timer = undefined
    pending = ''
    setImmediate(stopReplying)
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

    if (CSI_REPLY_RE.test(buffered)) {
      replying = true
      return endAfterThisChunk()
    }
    if (STRING_REPLY_RE.test(buffered)) {
      replying = true
      return STRING_TERMINATOR_RE.test(buffered) ? endAfterThisChunk() : awaitRest(buffered)
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
