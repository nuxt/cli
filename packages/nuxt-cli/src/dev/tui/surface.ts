import { Buffer } from 'node:buffer'
import process from 'node:process'

type WriteFn = typeof process.stdout.write

interface PatchableStream extends NodeJS.WriteStream {
  __write?: WriteFn
}

const REPAINT_DELAY_MS = 16
const PENDING_CHUNK_LIMIT = 2000

/**
 * Who owns the terminal. While a full-screen view owns it the panel paints
 * nothing and output waits for the panel to have the screen back.
 */
export type ScreenMode = 'split-footer' | 'alternate-screen'

/** What happens to output the panel did not write itself. */
export type ExternalOutput = 'passthrough' | 'capture'

/** Output waiting for the panel to own the screen again. */
interface PendingOutput {
  text: string
  /** Belongs in scrollback rather than with whatever is capturing output. */
  scrollback: boolean
}

/**
 * Keeps a block of lines pinned below normal terminal output.
 *
 * Scrollback stays native: whatever is allowed through is genuinely written to
 * the main buffer. Before each chunk the panel is erased, and a coalesced
 * repaint puts it back once the burst of writes settles.
 *
 * The two axes are independent, which is the shape OpenTUI (MIT) arrived at for
 * the same problem in its `CliRenderer`: {@link screenMode} says who owns the
 * terminal, {@link externalOutput} says where everyone else's output goes.
 * https://github.com/anomalyco/opentui
 */
export class PanelSurface {
  #lines: string[] = []
  #painted = 0
  /**
   * Whether the cursor sits at the start of a line, so the panel can attach
   * itself without a separator. An erase leaves it there; output that stops
   * mid-line does not.
   */
  #atLineStart = true
  #repaintTimer?: NodeJS.Timeout
  #restore: Array<() => void> = []
  #raw: WriteFn
  #closed = false
  #screen: ScreenMode = 'split-footer'
  #externalOutput: ExternalOutput = 'passthrough'
  #sink?: (chunk: string) => void
  #pending: PendingOutput[] = []
  #rowsWritten = 0
  #rows = process.stdout.rows || 24
  #onResize = () => {
    const rows = process.stdout.rows || 24
    const grew = rows > this.#rows
    this.#rows = rows
    // The owner re-renders; the cached lines were laid out for the old width.
    this.#erase()
    this.#resized?.()
    // A taller window leaves the panel stranded mid-screen, so it is re-seated
    // while the screen still has room. Shrinking is left alone: the panel is
    // already at the bottom and padding would push scrollback away.
    if (grew) {
      this.padToBottom()
    }
  }

  #resized?: () => void

  constructor(options: { onResize?: () => void } = {}) {
    this.#resized = options.onResize
    const stdout = process.stdout as PatchableStream
    this.#raw = (stdout.__write ?? stdout.write).bind(stdout)

    for (const stream of [process.stdout, process.stderr] as PatchableStream[]) {
      this.#guard(stream)
    }
    process.stdout.on('resize', this.#onResize)
    this.#restore.push(() => process.stdout.off('resize', this.#onResize))
  }

  /** Hand the terminal to a full-screen view, or take it back. */
  get screenMode(): ScreenMode {
    return this.#screen
  }

  set screenMode(mode: ScreenMode) {
    if (mode === this.#screen || this.#closed) {
      return
    }
    this.#screen = mode
    if (mode === 'alternate-screen') {
      this.#erase()
      return
    }
    this.#flush()
    this.#paint()
  }

  /**
   * Where output the panel did not write goes: to the terminal above the panel,
   * or to the sink given to {@link onExternalOutput}, which is how the panel can
   * stand alone with the log stream folded away behind it.
   */
  get externalOutput(): ExternalOutput {
    return this.#externalOutput
  }

  set externalOutput(mode: ExternalOutput) {
    this.#externalOutput = mode
  }

  /** Receive output instead of the terminal while capturing. */
  onExternalOutput(sink: (chunk: string) => void): void {
    this.#sink = sink
  }

  /** Replace the panel content and repaint whatever changed. */
  render(lines: string[]): void {
    const unchanged = this.#painted === lines.length && lines.every((line, index) => line === this.#lines[index])
    this.#lines = lines
    if (this.#closed || this.#screen === 'alternate-screen' || unchanged) {
      return
    }
    this.#erase()
    this.#paint()
  }

  /**
   * Fill the screen so the panel rests on the last row, otherwise it starts
   * just below the command and walks down the screen as output arrives.
   *
   * Rows already used are subtracted so a session that has printed nothing does
   * not push a whole screen of history out of view.
   */
  padToBottom(): void {
    if (this.#closed || this.#screen === 'alternate-screen') {
      return
    }
    this.#erase()
    const rows = process.stdout.rows || 24
    const padding = rows - this.#lines.length - this.#rowsWritten - 1
    if (padding > 0) {
      this.#raw('\n'.repeat(padding))
      this.#rowsWritten += padding
    }
    this.#paint()
  }

  /** Forget the rows counted so far, after the screen has been cleared. */
  resetRows(): void {
    this.#rowsWritten = 0
  }

  /** Write straight to the terminal, bypassing interception and the queue. */
  writeRaw(chunk: string): void {
    this.#raw(chunk)
  }

  /**
   * Put `text` into scrollback above the panel, whatever is capturing output.
   *
   * Written to the stream directly rather than through consola, whose deferred
   * write would be captured like any other output and surfaced twice. It always
   * ends a line, so the panel cannot end up sharing one with it.
   */
  writeAbove(text: string): void {
    const line = text.endsWith('\n') ? text : `${text}\n`
    if (this.#closed) {
      this.#raw(line)
      return
    }
    if (this.#screen === 'alternate-screen') {
      this.#queue({ text: line, scrollback: true })
      return
    }
    this.#toScrollback(line)
  }

  /** Erase the panel and stop intercepting writes. Scrollback is untouched. */
  close(options: { keep?: boolean } = {}): void {
    if (this.#closed) {
      return
    }
    this.#externalOutput = 'passthrough'
    this.#sink = undefined
    clearTimeout(this.#repaintTimer)
    this.#erase()
    // Whatever a view was holding is the session's last word on what happened,
    // and there is no longer anywhere to fold it away to.
    this.#screen = 'split-footer'
    this.#flush()
    if (options.keep && this.#lines.length) {
      this.#raw(`${this.#lines.join('\n')}\n`)
    }
    this.#closed = true
    for (const restore of this.#restore) {
      restore()
    }
  }

  /**
   * Intercept the stream's bottom-most write. Where consola has wrapped the
   * stream, `__write` is the sink its reporter and `writeDirect` use, so
   * guarding that catches formatted logs without re-entering consola.
   */
  #guard(stream: PatchableStream): void {
    const target = stream.__write ? '__write' as const : 'write' as const
    const original = stream[target] as WriteFn
    const guarded: WriteFn = (chunk: any, encoding?: any, callback?: any) => {
      if (this.#closed) {
        return original.call(stream, chunk, encoding, callback)
      }
      if (this.#screen === 'alternate-screen' || this.#externalOutput === 'capture') {
        const text = asText(chunk)
        if (text !== undefined) {
          this.#divert(text)
        }
        const done = typeof encoding === 'function' ? encoding : callback
        if (typeof done === 'function') {
          done()
        }
        return true
      }
      this.#erase()
      this.#track(asText(chunk))
      const result = original.call(stream, chunk, encoding, callback)
      this.#scheduleRepaint()
      return result
    }
    stream[target] = guarded
    this.#restore.push(() => {
      if (stream[target] === guarded) {
        stream[target] = original
      }
    })
  }

  /** Output the panel intercepted, held for a view or handed to the sink. */
  #divert(text: string): void {
    if (this.#screen === 'alternate-screen') {
      this.#queue({ text, scrollback: false })
      return
    }
    this.#sink?.(text)
  }

  #queue(output: PendingOutput): void {
    this.#pending.push(output)
    if (this.#pending.length > PENDING_CHUNK_LIMIT) {
      this.#pending.shift()
    }
  }

  /**
   * Deal with everything that arrived while a view owned the screen, as if the
   * view had never been open: intercepted output is folded away like any other,
   * and what was meant for scrollback lands there.
   */
  #flush(): void {
    const pending = this.#pending
    this.#pending = []
    for (const { text, scrollback } of pending) {
      if (scrollback || !this.#sink || this.#externalOutput === 'passthrough') {
        this.#toScrollback(text)
        continue
      }
      this.#sink(text)
    }
  }

  #toScrollback(text: string): void {
    this.#erase()
    this.#track(text)
    this.#raw(text)
    this.#scheduleRepaint()
  }

  #track(text: string | undefined): void {
    if (!text) {
      return
    }
    this.#rowsWritten += text.split('\n').length - 1
    this.#atLineStart = text.endsWith('\n')
  }

  #scheduleRepaint(): void {
    if (this.#repaintTimer) {
      return
    }
    this.#repaintTimer = setTimeout(() => {
      this.#repaintTimer = undefined
      if (!this.#closed && !this.#painted) {
        this.#paint()
      }
    }, REPAINT_DELAY_MS)
    this.#repaintTimer.unref?.()
  }

  #paint(): void {
    if (!this.#lines.length || this.#screen === 'alternate-screen') {
      return
    }
    const leading = this.#atLineStart ? '' : '\n'
    this.#raw(`${leading}${this.#lines.join('\n')}`)
    this.#painted = this.#lines.length
  }

  #erase(): void {
    if (!this.#painted) {
      return
    }
    const up = this.#painted - 1
    this.#raw(`\r${up > 0 ? `\u001B[${up}A` : ''}\u001B[J`)
    this.#painted = 0
    this.#atLineStart = true
  }
}

function asText(chunk: unknown): string | undefined {
  if (typeof chunk === 'string') {
    return chunk
  }
  return chunk instanceof Uint8Array ? Buffer.from(chunk).toString() : undefined
}
