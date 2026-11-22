import type { PhaseTiming, ProgressMeter, ProgressSnapshot } from './progress-snapshot'

import process from 'node:process'
import { styleText } from 'node:util'

import { isCI } from 'std-env'

import { supportsUnicode } from '../dev/tui/support'
import { decapitalise, formatDuration, terminalLink, visibleWidth } from './formatting'
import { logger } from './logger'
import { READY_MESSAGE } from './progress-snapshot'
import { onScreenHeld } from './screen'
import { tapOutput } from './stdout'
import { MUTED } from './terminal-theme'

const FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
]
const FRAME_INTERVAL = 80
const CLEAR_LINE = '\r\u001B[2K'
const COLUMN_ONE = '\r'

/**
 * How far the phase clock has to be behind the total before both are worth
 * showing. During the first phase they are the same number twice.
 */
const PHASE_ELAPSED_THRESHOLD = 100

const METER_WIDTH = 20

/** The shortest a meter's detail is cut to before it is left out. */
const METER_DETAIL_MIN = 8

const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

/**
 * A ticking elapsed time, in tenths of a second. Anything finer changes the
 * line on every frame, which is the whole cost the frame-only repaint avoids.
 */
/**
 * How long the phase in flight has taken, and how long the command has been
 * running, where those have parted company. A phase can hold a command for most
 * of its run, and its own clock is what says a still label is still working.
 */
function formatElapsed(snapshot: ProgressSnapshot, drift: number): string {
  const total = snapshot.elapsed + drift
  const phase = snapshot.phaseElapsed + drift
  return total - phase >= PHASE_ELAPSED_THRESHOLD
    ? `${formatDuration(phase)} \u00B7 total ${formatDuration(total)}`
    : formatDuration(total)
}

/** `42/180`, for output that has no room for a bar. */
function formatCount(meter: ProgressMeter | undefined): string {
  return meter
    ? ` ${meter.done}/${meter.total}`
    : ''
}

/** `━━━━━━━━ 42/180`, drawn like the progress bar in the `nuxt dev` panel. */
export function formatMeter(meter: ProgressMeter, width: number = METER_WIDTH): string {
  const filled = meter.total
    ? Math.min(width, Math.floor(meter.done / meter.total * width))
    : 0
  const glyph = supportsUnicode()
    ? '━'
    : '='
  return `${styleText('green', glyph.repeat(filled))}${styleText(MUTED, glyph.repeat(width - filled))} ${styleText(MUTED, `${meter.done}/${meter.total}`)}`
}

/** Cut `text` to `width` columns, or drop it when too little of it would be left. */
function fit(text: string, width: number): string {
  if (text.length <= width) {
    return text
  }
  return width >= METER_DETAIL_MIN
    ? `\u2026${text.slice(text.length - width + 1)}`
    : ''
}

function bundlePhaseLabels(phase: string): string[] | undefined {
  return phase.startsWith('bundle:')
    ? phase.slice('bundle:'.length).split('+')
    : undefined
}

export interface PhaseReporter {
  update: (snapshot: ProgressSnapshot) => void
  /** The URL to print alongside the summary, once one is known. */
  setURL: (url: string) => void
  stop: () => void
}

interface PhaseReporterOptions {
  stream?: NodeJS.WriteStream
  /** Force the animated line on or off; detected from the environment otherwise. */
  animated?: boolean
  /**
   * How often a phase that is still running repeats itself, in milliseconds,
   * when there is no animated line to show that time is passing. Off by
   * default; only worth it where a single phase can run for minutes.
   */
  heartbeat?: number
}

export function isAnimationSupported(stream: NodeJS.WriteStream = process.stdout): boolean {
  return !!stream.isTTY && !isCI && !process.env.NO_COLOR
}

/** `config 40ms · modules 1.2s · …`, or nothing if every phase was trivial. */
export function formatPhaseBreakdown(timings: PhaseTiming[]): string {
  return timings
    .filter(timing => timing.duration >= 10)
    .map(timing => `${timing.phase} ${formatDuration(timing.duration)}`)
    .join(' · ')
}

const PHASE_BAR_WIDTH = 24

/**
 * One phase per line with a bar placed where it ran within the command, so the
 * slow step stands out and phases that overlapped are seen to.
 */
export function formatPhaseTable(timings: PhaseTiming[]): string {
  let elapsed = 0
  const placed = timings.map((timing) => {
    const start = timing.start ?? elapsed
    elapsed = Math.max(elapsed, start + timing.duration)
    return { ...timing, start }
  })
  const shown = placed.filter(timing => timing.duration >= 10)
  if (!shown.length) {
    return ''
  }
  const from = Math.min(...shown.map(timing => timing.start))
  const span = Math.max(1, Math.max(...shown.map(timing => timing.start + timing.duration)) - from)
  const nameWidth = Math.max(...shown.map(timing => timing.phase.length))
  const durations = shown.map(timing => formatDuration(timing.duration))
  const durationWidth = Math.max(...durations.map(duration => duration.length))
  return shown.map((timing, index) => {
    const left = Math.min(PHASE_BAR_WIDTH - 1, Math.floor((timing.start - from) / span * PHASE_BAR_WIDTH))
    const right = Math.max(left + 1, Math.round((timing.start - from + timing.duration) / span * PHASE_BAR_WIDTH))
    const bar = `${' '.repeat(left)}${styleText('cyan', '█'.repeat(right - left))}${' '.repeat(PHASE_BAR_WIDTH - right)}`
    return `${timing.phase.padEnd(nameWidth)}  ${bar}  ${styleText(MUTED, durations[index]!.padStart(durationWidth))}`
  }).join('\n')
}

/**
 * The URL the summary points at, so the address is on screen at the moment the
 * user is being told they can click it rather than a screenful further up.
 */
function formatURL(url: string): string {
  return `  ${styleText('dim', '\u2192')} ${styleText('cyan', terminalLink(url, url))}`
}

/**
 * The line a long-running command leaves behind once it is up. A command that
 * only builds never reaches `ready` and reports its own completion instead.
 */
export function formatSummary(snapshot: ProgressSnapshot, url?: string): string {
  const breakdown = formatPhaseBreakdown(snapshot.timings)
  // Whatever the ready phase is still waiting on, if it is waiting on anything.
  const detail = snapshot.serving || !snapshot.message || snapshot.message === READY_MESSAGE
    ? ''
    : styleText('dim', ` \u00B7 ${decapitalise(snapshot.message)}`)
  const headline = `${snapshot.reload ? 'Reloaded' : 'Ready'} in ${formatDuration(snapshot.elapsed)}${detail}${
    url
      ? formatURL(url)
      : ''}`
  return breakdown
    ? `${headline}\n${styleText('dim', breakdown)}`
    : headline
}

/**
 * Report progress through a command's phases on a single line that updates in
 * place, collapsing to one summary line with a phase breakdown once the command
 * reports itself ready, and then narrating the first page render, which is where
 * the rest of the wait is spent. Falls back to sequential logs when the output
 * is not an interactive terminal.
 */
export function createPhaseReporter(options: PhaseReporterOptions = {}): PhaseReporter {
  const stream = options.stream ?? process.stdout
  const animated = options.animated ?? isAnimationSupported(stream)

  let snapshot: ProgressSnapshot | undefined
  let summarised = false
  let lastPhase: string | undefined
  let lastMessage: string | undefined
  let lastLoggedAt = 0
  let frame = 0
  let dirty = false
  let painted: string | undefined
  /** Whether the cursor is currently hidden for the transient line. */
  let hidden = false
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let withheld = false
  /** The latest line that was due while a question held the screen. */
  let missed: [line: string, message: string] | undefined
  let receivedAt = Date.now()
  let pulse: NodeJS.Timeout | undefined
  let url: string | undefined
  /** The request the line is currently reporting, so it is announced once. */
  let narrating: string | undefined
  /** Whether the wait was ever narrated, and so is worth closing off. */
  let narrated = false
  /** When the render being waited on arrived, so the wait can be measured. */
  let renderStartedAt: number | undefined

  // Foreign output would otherwise be written on top of the transient line. The
  // tap sits below `consola.wrapAll()`, which `nuxt dev` installs, for two
  // reasons: consola's reporter writes through `__write` and would not be seen
  // above it, and its wrapper trims each chunk and logs it as a line of its own,
  // which turns a line that redraws itself into one line per frame. Writing
  // through the tap's own handle also keeps the transient line invisible to this
  // listener and to the spacing tracker.
  const tap = animated
    ? tapOutput(stream, () => clear())
    : undefined
  const write = tap?.write ?? stream.write.bind(stream)

  function log(line: string, message: string) {
    if (withheld) {
      missed = [line, message]
      return
    }
    lastMessage = message
    lastLoggedAt = Date.now()
    logger.info(line)
  }

  function clear() {
    if (dirty) {
      write(CLEAR_LINE)
      dirty = false
      painted = undefined
    }
  }

  /**
   * The line after the spinner glyph: what the command is doing and how long it
   * has been doing it. Once the summary is printed that is no longer a phase but
   * the request being rendered, which has its own clock.
   */
  function describe(): string {
    const pending = summarised ? snapshot!.pending : undefined
    if (pending) {
      return `rendering ${pending.label} ${styleText(MUTED, formatDuration(Date.now() - pending.startedAt))}`
    }
    const { meter } = snapshot!
    const line = `${snapshot!.message}${meter
      ? ` ${formatMeter(meter)}`
      : ''} ${styleText(MUTED, formatElapsed(snapshot!, Date.now() - receivedAt))}`
    if (!meter?.detail) {
      return line
    }
    // A line that wraps cannot be cleared in place, so the detail gives way to the terminal width.
    const room = (stream.columns || 80) - visibleWidth(line) - 4
    const detail = fit(meter.detail, room)
    return detail
      ? `${line} ${styleText(MUTED, detail)}`
      : line
  }

  function render() {
    if (!snapshot || stopped || withheld) {
      return
    }
    const glyph = styleText('cyan', FRAMES[frame = (frame + 1) % FRAMES.length]!)
    const line = describe()
    // Only the glyph moves between most frames, and rewriting the line for it
    // costs a clear and a repaint of everything that did not change.
    if (dirty && line === painted) {
      write(`${COLUMN_ONE}${glyph}`)
      return
    }
    clear()
    write(`${glyph} ${line}`)
    painted = line
    dirty = true
  }

  function animate() {
    if (!animated || timer || withheld) {
      return
    }
    hidden = true
    write(HIDE_CURSOR)
    timer = setInterval(render, FRAME_INTERVAL)
    timer.unref?.()
  }

  animate()

  const offScreen = onScreenHeld((held) => {
    if (held) {
      withhold()
    }
    else {
      resumePainting()
    }
  })

  /**
   * Repeat whatever is in flight, with the time it has taken so far, so a long
   * silent stretch in a piped log still shows something is alive. A render is
   * repeated the same way: nothing else is printed while it compiles.
   */
  function schedulePulse() {
    clearInterval(pulse)
    pulse = undefined
    if (!options.heartbeat || animated || withheld) {
      return
    }
    pulse = setInterval(() => {
      if (!snapshot || stopped) {
        return
      }
      const pending = summarised ? snapshot.pending : undefined
      if (pending) {
        log(announce(pending.label, Date.now() - pending.startedAt), `rendering ${pending.label}`)
        return
      }
      log(`${snapshot.message}${formatCount(snapshot.meter)} ${styleText('dim', `(${formatElapsed(snapshot, Date.now() - receivedAt)})`)}`, snapshot.message)
    }, options.heartbeat)
    pulse.unref?.()
  }

  /** A render, as its own line, for output that cannot redraw one in place. */
  function announce(label: string, elapsed?: number): string {
    return `Rendering ${label}${elapsed === undefined
      ? ''
      : ` ${styleText('dim', `(${formatDuration(elapsed)})`)}`}`
  }

  /** Take the line down, leaving the terminal as it was found. */
  function restore() {
    clearInterval(pulse)
    pulse = undefined
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (animated && hidden) {
      hidden = false
      clear()
      write(SHOW_CURSOR)
    }
  }

  function finish() {
    stopped = true
    offScreen()
    restore()
    tap?.dispose()
  }

  function withhold(): void {
    if (stopped || withheld) {
      return
    }
    withheld = true
    restore()
  }

  function resumePainting(): void {
    if (stopped || !withheld) {
      return
    }
    withheld = false
    if (missed) {
      log(...missed)
      missed = undefined
    }
    if (summarised && !snapshot?.pending) {
      return
    }
    if (!animated) {
      schedulePulse()
      return
    }
    animate()
    render()
  }

  return {
    setURL(next) {
      url = next
    },
    update(next) {
      if (stopped) {
        return
      }
      // The summary is printed; the only thing left to report is the first
      // render, and a reload is narrated by whoever asked for it.
      if (summarised && next.status !== 'ready') {
        return
      }
      snapshot = next
      receivedAt = Date.now()

      if (next.status === 'error') {
        finish()
        return
      }

      if (next.status !== 'ready') {
        if (animated) {
          // A meter can move hundreds of times a second; the next frame picks it up.
          if (!next.meter || next.phase !== lastPhase) {
            lastPhase = next.phase
            render()
          }
          return
        }

        if (next.phase !== lastPhase) {
          const previous = lastPhase === undefined
            ? undefined
            : bundlePhaseLabels(lastPhase)
          const current = bundlePhaseLabels(next.phase)
          // A bundle finishing only shrinks the active set, which the line that
          // announced the bundle starting has already covered.
          const finishing = previous !== undefined
            && current !== undefined
            && current.length < previous.length
            && current.every(label => previous.includes(label))
          lastPhase = next.phase
          if (!finishing) {
            log(next.message, next.message)
            schedulePulse()
          }
          return
        }

        // Within a phase the message is narration rather than progress, so it is
        // only worth a line where the phase is long enough to have a heartbeat,
        // and never more often than one. The phase clock goes with it: without an
        // animated line it is the only sign the wait is still moving.
        if (options.heartbeat && next.message !== lastMessage && Date.now() - lastLoggedAt >= options.heartbeat) {
          log(`${next.message} ${styleText('dim', `(${formatElapsed(next, 0)})`)}`, next.message)
        }
        return
      }

      if (!summarised) {
        restore()
        summarised = true
        missed = undefined
        narrated = !next.serving && next.message !== READY_MESSAGE
        logger.success(formatSummary(next, url))
      }

      // Accepting requests is not answering one: until a page has been
      // rendered, whatever the server is busy with is the wait the user is
      // actually in, so it is reported rather than left silent.
      if (next.serving) {
        restore()
        if (narrated) {
          // Measured from the request rather than from startup: the server may
          // have been sitting idle and ready for minutes before anyone asked.
          logger.success(renderStartedAt === undefined
            ? `Serving in ${formatDuration(next.elapsed)}`
            : `First render in ${formatDuration(Date.now() - renderStartedAt)}`)
        }
        finish()
        return
      }

      if (!next.pending) {
        narrating = undefined
        restore()
        return
      }

      narrated = true
      renderStartedAt ??= next.pending.startedAt
      if (animated) {
        animate()
        render()
        return
      }
      // A pipe cannot redraw, so the request is announced as it starts and then
      // repeated on the heartbeat, which is all that says the wait is moving.
      if (narrating !== next.pending.label) {
        narrating = next.pending.label
        log(announce(next.pending.label), `rendering ${next.pending.label}`)
        schedulePulse()
      }
    },
    stop() {
      finish()
    },
  }
}
