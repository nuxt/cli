/**
 * The screen, and the question that may be holding it.
 *
 * A question redraws its own lines and positions them with the cursor, so
 * anything else painting at the same time both corrupts them and is erased by
 * their next redraw. A hold marks the stretch a question is on screen, so
 * animated output can step aside for it.
 */

type Listener = (held: boolean) => void

const listeners = new Set<Listener>()
let holds = 0

/**
 * Take the screen for a question. The returned function gives it back, and does
 * nothing when called again.
 */
export function holdScreen(): () => void {
  if (holds++ === 0) {
    notify(true)
  }
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    if (--holds === 0) {
      notify(false)
    }
  }
}

/** Watch for a question taking the screen and giving it back. */
export function onScreenHeld(listener: Listener): () => void {
  listeners.add(listener)
  if (holds > 0) {
    listener(true)
  }
  return () => {
    listeners.delete(listener)
  }
}

/** Whether a question is on screen right now. */
export function isScreenHeld(): boolean {
  return holds > 0
}

function notify(held: boolean): void {
  for (const listener of [...listeners]) {
    listener(held)
  }
}

let unseenOutput: (() => string) | undefined

/**
 * Register the source of output kept off the screen: `source` returns what was
 * held back during the current turn of the event loop. The returned function
 * withdraws it.
 */
export function registerUnseenOutput(source: () => string): () => void {
  unseenOutput = source
  return () => {
    if (unseenOutput === source) {
      unseenOutput = undefined
    }
  }
}

/** Take what was printed during the current turn of the event loop and kept off the screen. */
export function takeUnseenOutput(): string {
  return unseenOutput?.() ?? ''
}
