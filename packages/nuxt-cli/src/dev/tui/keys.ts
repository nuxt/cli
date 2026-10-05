import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'

import { guardReplayedInput } from '../../utils/console'
import { whenStdinReleased } from './background'
import { filterTerminalReplies } from './terminal-replies'

export interface Key {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  sequence?: string
}

/**
 * Deliver raw keypresses, excluding terminal replies. The handler owns Ctrl-C.
 * Set `ignoreBufferedInput` when returning from a prompt.
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
