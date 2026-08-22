import { Buffer } from 'node:buffer'
import process from 'node:process'

type WriteFn = typeof process.stdout.write

interface PatchableStream extends NodeJS.WriteStream {
  __write?: WriteFn
}

const REPAINT_DELAY_MS = 16
const HELD_CHUNK_LIMIT = 2000

/**
 * Keeps a block of lines pinned below normal terminal output.
 *
 * Scrollback stays native: whatever is allowed through is genuinely written to
 * the main buffer. Before each chunk the panel is erased, and a coalesced
 * repaint puts it back once the burst of writes settles.
 */
export class PanelSurface {
  #lines: string[] = []
  #painted = 0
  #endedWithNewline = true
  #repaintTimer?: NodeJS.Timeout
  #restore: Array<() => void> = []
  #raw: WriteFn
  #closed = false
  #held?: Array<string | Uint8Array>
  #rowsWritten = 0
  #capture?: (chunk: string) => void
  #rows = process.stdout.rows || 24
  #onResize = () => {
    const rows = process.stdout.rows || 24
    const grew = rows > this.#rows
    this.#rows = rows
    // The owner re-renders; the cached lines were laid out for the old width.
    this.#erase()
    this.#resized?.()
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

  /** Replace the panel content and repaint whatever changed. */
  render(lines: string[]): void {
    const unchanged = this.#painted === lines.length && lines.every((line, index) => line === this.#lines[index])
    this.#lines = lines
    if (this.#closed || (unchanged && !this.#held)) {
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
    if (this.#closed || this.#held) {
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

  /** Write straight to the terminal, bypassing interception and hold mode. */
  writeRaw(chunk: string): void {
    this.#raw(chunk)
  }

  /**
   * Divert intercepted output to `handler` instead of the screen, so the panel
   * can stand alone with the log stream folded away behind it. Called with
   * nothing, output reaches the terminal again.
   */
  setCapture(handler?: (chunk: string) => void): void {
    this.#capture = handler
  }

  /**
   * Put `chunk` into scrollback above the panel, whatever is being captured.
   *
   * Written to the stream directly rather than through consola, whose deferred
   * write would be captured like any other output and surfaced twice.
   */
  writeAbove(chunk: string): void {
    if (this.#closed) {
      this.#raw(chunk)
      return
    }
    this.#erase()
    this.#observe(chunk)
    this.#raw(chunk)
    this.#scheduleRepaint()
  }

  /**
   * Stop output reaching the screen, queueing it instead. Used while an
   * alternate-buffer overlay owns the terminal, so background logs cannot
   * draw over it.
   */
  hold(): void {
    if (this.#held) {
      return
    }
    this.#erase()
    this.#held = []
  }

  /** Flush everything queued during {@link hold} and repaint the footer. */
  release(): void {
    const held = this.#held
    if (!held) {
      return
    }
    this.#held = undefined
    for (const chunk of held) {
      this.#observe(chunk)
      this.#raw(chunk)
    }
    this.#paint()
  }

  /** Erase the panel and stop intercepting writes. Scrollback is untouched. */
  close(options: { keep?: boolean } = {}): void {
    if (this.#closed) {
      return
    }
    this.#capture = undefined
    this.#held = undefined
    clearTimeout(this.#repaintTimer)
    this.#erase()
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
      const writable = typeof chunk === 'string' || chunk instanceof Uint8Array ? chunk as string | Uint8Array : undefined
      if (this.#held || this.#capture) {
        if (writable !== undefined) {
          if (this.#held) {
            this.#held.push(writable)
            if (this.#held.length > HELD_CHUNK_LIMIT) {
              this.#held.shift()
            }
          }
          else {
            this.#capture!(typeof writable === 'string' ? writable : Buffer.from(writable).toString())
          }
        }
        const done = typeof encoding === 'function' ? encoding : callback
        if (typeof done === 'function') {
          done()
        }
        return true
      }
      this.#erase()
      if (writable !== undefined) {
        this.#observe(writable)
      }
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

  #observe(chunk: string | Uint8Array): void {
    if (!chunk.length) {
      return
    }
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    this.#rowsWritten += text.split('\n').length - 1
    const last = chunk[chunk.length - 1]
    this.#endedWithNewline = last === '\n' || last === 0x0A
  }

  #scheduleRepaint(): void {
    if (this.#repaintTimer) {
      return
    }
    this.#repaintTimer = setTimeout(() => {
      this.#repaintTimer = undefined
      if (!this.#closed && !this.#painted && !this.#held) {
        this.#paint()
      }
    }, REPAINT_DELAY_MS)
    this.#repaintTimer.unref?.()
  }

  #paint(): void {
    // While held, an overlay owns the screen and the footer must stay off it.
    if (!this.#lines.length || this.#held) {
      return
    }
    const leading = this.#endedWithNewline ? '' : '\n'
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
    // The erase leaves the cursor at column 0 of a fresh line, so the next
    // paint must not insert another separator newline.
    this.#endedWithNewline = true
  }
}
