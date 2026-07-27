import process from 'node:process'

/** One blank line needs two newlines: one to end the last line, one to skip a row. */
const BLANK_LINE = 2

/**
 * How many newlines everything written so far ends with, capped at the most a
 * caller can ask about. Starts at one because a shell hands us a cursor at the
 * start of an empty line and nothing has been written to move it.
 */
let trailingNewlines = 1
let tracking = false

function isNewline(chunk: string | Uint8Array, index: number): boolean {
  return typeof chunk === 'string' ? chunk[index] === '\n' : chunk[index] === 0x0A
}

/**
 * Record `chunk` as written to stdout. Exported for the tracker's tests; every
 * other caller should go through {@link trackOutputSpacing}.
 */
export function observeOutput(chunk: string | Uint8Array): void {
  if (!chunk.length) {
    return
  }
  let newlines = 0
  while (newlines < chunk.length && isNewline(chunk, chunk.length - 1 - newlines)) {
    newlines++
  }
  // A chunk of nothing but newlines continues the run the last one left off at.
  const total = newlines === chunk.length ? trailingNewlines + newlines : newlines
  trailingNewlines = Math.min(total, BLANK_LINE)
}

/**
 * The newlines to write before a block of output for it to be separated from
 * whatever came before by exactly one blank line, wherever the cursor is now.
 */
export function blankLineBefore(): string {
  return '\n'.repeat(Math.max(0, BLANK_LINE - trailingNewlines))
}

/**
 * Watch stdout so {@link blankLineBefore} knows how much vertical space is
 * already on screen. Every writer has to be seen for the count to be right, so
 * this is installed as soon as something knows it will print later, and stays.
 */
export function trackOutputSpacing(): void {
  if (tracking) {
    return
  }
  tracking = true
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
      observeOutput(chunk)
    }
    return (write as (...args: unknown[]) => boolean)(chunk, encoding, callback)
  }) as typeof process.stdout.write
}
