/**
 * The one stdin, and the terminal query that may be holding it.
 *
 * Asking the terminal a question (its background colour) means reading the
 * answer off stdin, so anything else that reads stdin in the meantime sees the
 * answer as keystrokes and can have its own input taken as the reply. A hold
 * marks that stretch, so the next reader can wait for it to be over.
 */

let held: Promise<void> | undefined

/**
 * Take stdin for a query that has to read the terminal's answer. The returned
 * function gives it back, and does nothing when called again.
 */
export function holdStdin(): () => void {
  let released = false
  let settle!: () => void
  const current = new Promise<void>((resolve) => {
    settle = resolve
  })
  held = current
  return () => {
    if (released) {
      return
    }
    released = true
    if (held === current) {
      held = undefined
    }
    settle()
  }
}

/** Settles once the query holding stdin has given it back, if one is holding it. */
export function whenStdinReleased(): Promise<void> | undefined {
  return held
}
