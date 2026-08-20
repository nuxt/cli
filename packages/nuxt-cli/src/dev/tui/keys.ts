import process from 'node:process'
import { emitKeypressEvents } from 'node:readline'

export interface Key {
  name?: string
  ctrl?: boolean
  sequence?: string
}

/**
 * Put stdin into raw mode and deliver single keypresses.
 *
 * Raw mode means the terminal no longer turns Ctrl-C into `SIGINT`, so the
 * handler receives it as a key and is responsible for shutdown.
 */
export function attachKeys(onKey: (key: Key) => void): () => void {
  const { stdin } = process
  emitKeypressEvents(stdin)
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()

  const handler = (_input: string, key: Key | undefined) => {
    if (key) {
      onKey(key)
    }
  }
  stdin.on('keypress', handler)

  return () => {
    stdin.off('keypress', handler)
    if (stdin.isTTY) {
      stdin.setRawMode(wasRaw ?? false)
    }
    stdin.pause()
  }
}
