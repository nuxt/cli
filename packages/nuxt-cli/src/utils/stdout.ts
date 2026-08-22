import process from 'node:process'

import { hasTTY, isCI, isTest } from 'std-env'

/** Whether this process is attached to a terminal a user can answer prompts on. */
export function isInteractiveSession(): boolean {
  return !!process.stdin.isTTY && !isCI
}

/**
 * Whether a question can be asked and answered right now. `hasTTY` is required
 * as well as an interactive session, so a prompt cannot be written into a
 * redirected stdout where nobody will see it.
 */
export function isInteractive(): boolean {
  return isInteractiveSession() && hasTTY && !isTest
}

/** One blank line needs two newlines: one to end the last line, one to skip a row. */
const BLANK_LINE = 2

/**
 * How many newlines everything written so far ends with, capped at the most a
 * caller can ask about. Starts at one because a shell hands us a cursor at the
 * start of an empty line and nothing has been written to move it.
 */
let trailingNewlines = 1

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

type OutputListener = (chunk: string | Uint8Array) => void

/**
 * `consola.wrapAll()`, which `nuxt dev` installs, moves the real `write` to
 * `__write` and replaces `write` with one that trims each chunk and logs it as a
 * line of its own. Its own reporter then writes through `__write`, so a wrapper
 * installed over `write` sees neither the framework's output nor its own cursor
 * control sequences intact.
 */
type ConsolaWrapped = NodeJS.WriteStream & { __write?: NodeJS.WriteStream['write'] }

/** The lowest `write` on the stream: below consola's line logger, if it is there. */
function baseWrite(stream: ConsolaWrapped): NodeJS.WriteStream['write'] {
  return stream.__write ?? stream.write
}

function installBaseWrite(stream: ConsolaWrapped, write: NodeJS.WriteStream['write']): void {
  if (stream.__write) {
    stream.__write = write
  }
  else {
    stream.write = write
  }
}

interface StreamTap {
  /** The stream's own `write`, below both consola and this wrapper. */
  write: NodeJS.WriteStream['write']
  wrapper: NodeJS.WriteStream['write']
  listeners: Set<OutputListener>
}

const taps = new WeakMap<NodeJS.WriteStream, StreamTap>()

export interface OutputTap {
  /** Write to the stream without notifying any listener, including your own. */
  write: NodeJS.WriteStream['write']
  /** Detach this listener. The shared wrapper stays installed. */
  dispose: () => void
}

/**
 * Watch everything written to `stream`, and get a handle on the stream's own
 * `write` to bypass both this wrapper and anything layered above it.
 *
 * More than one part of the CLI watches stdout at a time, so the wrapper is
 * shared: a listener that uninstalled on the way out would take the others with
 * it. It is reinstalled if anything else has replaced `write` since.
 */
export function tapOutput(stream: NodeJS.WriteStream, listener: OutputListener): OutputTap {
  let tap = taps.get(stream)

  if (!tap || baseWrite(stream) !== tap.wrapper) {
    const write = baseWrite(stream).bind(stream)
    const listeners = tap?.listeners ?? new Set<OutputListener>()
    const wrapper = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
        for (const listener of [...listeners]) {
          listener(chunk)
        }
      }
      return (write as (...args: unknown[]) => boolean)(chunk, encoding, callback)
    }) as NodeJS.WriteStream['write']

    tap = { write, wrapper, listeners }
    taps.set(stream, tap)
    installBaseWrite(stream, wrapper)
  }

  tap.listeners.add(listener)
  return { write: tap.write, dispose: () => void tap!.listeners.delete(listener) }
}

/**
 * Watch stdout so {@link blankLineBefore} knows how much vertical space is
 * already on screen. Every writer has to be seen for the count to be right, so
 * this is installed as soon as something knows it will print later, and stays.
 */
export function trackOutputSpacing(): void {
  tapOutput(process.stdout, observeOutput)
}

/**
 * Write to stdout bypassing consola's line wrapping, for output that carries its
 * own newlines (see {@link withDirectStdout}). Consola would trim the chunk,
 * dropping any deliberate leading or trailing blank line.
 */
export function writeDirect(chunk: string): void {
  writeDirectTo(process.stdout, chunk)
}

/** {@link writeDirect} for an arbitrary standard stream. */
export function writeDirectTo(stream: NodeJS.WriteStream, chunk: string | Uint8Array): void {
  const target = stream as NodeJS.WriteStream & { __write?: typeof stream.write }
  ;(target.__write || target.write).call(stream, chunk)
}
