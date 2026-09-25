import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'

import { guardReplayedInput } from '../../utils/console'
import { whenStdinReleased } from './background'
import { filterTerminalReplies } from './terminal-replies'

export interface Key {
  name?: string
  ctrl?: boolean
  sequence?: string
}

/**
 * Put stdin into raw mode and deliver single keypresses.
 *
 * Raw mode means the terminal no longer turns Ctrl-C into `SIGINT`, so the
 * handler receives it as a key and is responsible for shutdown. Replies from
 * the terminal are dropped, and keys wait until the background query has
 * finished with stdin.
 *
 * Pass `ignoreBufferedInput` when taking stdin back after something else held
 * it, such as a prompt: what the terminal buffered meanwhile was typed at that,
 * not at the panel.
 */
export function attachKeys(onKey: (key: Key) => void, { ignoreBufferedInput = false }: { ignoreBufferedInput?: boolean } = {}): () => void {
  let release: (() => void) | undefined
  let detached = false

  function attach(): void {
    if (detached) {
      return
    }
    const { stdin } = process
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)

    const replies = filterTerminalReplies(stdin)
    const isReplayedInput = ignoreBufferedInput ? guardReplayedInput() : () => false

    emitKeypressEvents(stdin)
    stdin.resume()

    const handler = (_input: string, key: Key | undefined) => {
      if (replies.isReplying() || isReplayedInput()) {
        return
      }
      if (key) {
        onKey(key)
      }
    }
    stdin.on('keypress', handler)

    release = () => {
      replies.stop()
      stdin.off('keypress', handler)
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw ?? false)
      }
      stdin.pause()
    }
  }

  // Synchronous when nothing holds stdin, so a caller can deliver a key at once.
  const held = whenStdinReleased()
  if (held) {
    void held.then(attach)
  }
  else {
    attach()
  }

  return () => {
    detached = true
    release?.()
    release = undefined
  }
}
