import type { PhaseTiming, ProgressSnapshot } from './progress-snapshot'

import process from 'node:process'
import { styleText } from 'node:util'

import { isCI } from 'std-env'

import { formatDuration } from './formatting'
import { logger } from './logger'
import { tapOutput } from './stdout'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_INTERVAL = 80
const CLEAR_LINE = '\r\u001B[2K'
const COLUMN_ONE = '\r'

/**
 * How far the phase clock has to be behind the total before both are worth
 * showing. During the first phase they are the same number twice.
 */
const PHASE_ELAPSED_THRESHOLD = 100

const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

/**
 * A ticking elapsed time, in tenths of a second. Anything finer changes the
 * line on every frame, which is the whole cost the frame-only repaint avoids.
 */
function formatTicking(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  return `${minutes}m ${Math.floor((ms - minutes * 60_000) / 1000)}s`
}

/**
 * How long the phase in flight has taken, and how long the command has been
 * running, where those have parted company. A phase can hold a command for most
 * of its run, and its own clock is what says a still label is still working.
 */
function formatElapsed(snapshot: ProgressSnapshot, drift: number): string {
  const total = snapshot.elapsed + drift
  const phase = snapshot.phaseElapsed + drift
  return total - phase >= PHASE_ELAPSED_THRESHOLD
    ? `${formatTicking(phase)} \u00B7 ${formatTicking(total)}`
    : formatTicking(total)
}

export interface PhaseReporter {
  update: (snapshot: ProgressSnapshot) => void
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

/**
 * The line a long-running command leaves behind once it is up. A command that
 * only builds never reaches `ready` and reports its own completion instead.
 */
export function formatSummary(snapshot: ProgressSnapshot): string {
  const breakdown = formatPhaseBreakdown(snapshot.timings)
  const headline = `${snapshot.reload ? 'Reloaded' : 'Ready'} in ${formatDuration(snapshot.elapsed)}${
    snapshot.serving ? '' : styleText('dim', ' \u00B7 compiling the first request')}`
  return breakdown ? `${headline}\n${styleText('dim', breakdown)}` : headline
}

/**
 * Report progress through a command's phases on a single line that updates in
 * place, collapsing to one summary line with a phase breakdown once the command
 * reports itself ready. Falls back to sequential logs when the output is not an
 * interactive terminal.
 */
export function createPhaseReporter(options: PhaseReporterOptions = {}): PhaseReporter {
  const stream = options.stream ?? process.stdout
  const animated = options.animated ?? isAnimationSupported(stream)

  let snapshot: ProgressSnapshot | undefined
  let served = false
  let lastPhase: string | undefined
  let lastMessage: string | undefined
  let lastLoggedAt = 0
  let frame = 0
  let dirty = false
  let painted: string | undefined
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let receivedAt = Date.now()
  let pulse: NodeJS.Timeout | undefined

  // Foreign output would otherwise be written on top of the transient line. The
  // tap sits below `consola.wrapAll()`, which `nuxt dev` installs, for two
  // reasons: consola's reporter writes through `__write` and would not be seen
  // above it, and its wrapper trims each chunk and logs it as a line of its own,
  // which turns a line that redraws itself into one line per frame. Writing
  // through the tap's own handle also keeps the transient line invisible to this
  // listener and to the spacing tracker.
  const tap = animated ? tapOutput(stream, () => clear()) : undefined
  const write = tap?.write ?? stream.write.bind(stream)

  function log(line: string, message: string) {
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

  /** The line after the spinner glyph: the phase and how long it has taken. */
  function describe(): string {
    return `${snapshot!.message} ${styleText('dim', formatElapsed(snapshot!, Date.now() - receivedAt))}`
  }

  function render() {
    if (!snapshot || stopped) {
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

  if (animated) {
    write(HIDE_CURSOR)
    timer = setInterval(render, FRAME_INTERVAL)
    timer.unref?.()
  }

  /**
   * Repeat the phase in flight, with the time it has taken so far, so a long
   * silent stretch in a piped log still shows the build is alive.
   */
  function schedulePulse() {
    clearInterval(pulse)
    pulse = undefined
    if (!options.heartbeat || animated) {
      return
    }
    pulse = setInterval(() => {
      if (snapshot && !stopped) {
        log(`${snapshot.message} ${styleText('dim', `(${formatElapsed(snapshot, Date.now() - receivedAt)})`)}`, snapshot.message)
      }
    }, options.heartbeat)
    pulse.unref?.()
  }

  function restore() {
    clearInterval(pulse)
    pulse = undefined
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (animated) {
      clear()
      write(SHOW_CURSOR)
      tap?.dispose()
    }
  }

  return {
    update(next) {
      if (stopped) {
        return
      }
      // The summary is printed; the only thing left to say is that the first
      // request has been answered.
      if (served && next.status !== 'ready') {
        return
      }
      snapshot = next
      receivedAt = Date.now()

      if (next.status === 'error') {
        restore()
        stopped = true
        return
      }

      if (next.status === 'ready') {
        if (served) {
          if (next.serving) {
            stopped = true
            logger.success(`Serving in ${formatDuration(next.elapsed)}`)
          }
          return
        }
        restore()
        served = true
        stopped = next.serving
        logger.success(formatSummary(next))
        return
      }

      if (animated) {
        render()
        return
      }

      if (next.phase !== lastPhase) {
        lastPhase = next.phase
        log(next.message, next.message)
        schedulePulse()
        return
      }

      // Within a phase the message is narration rather than progress, so it is
      // only worth a line where the phase is long enough to have a heartbeat,
      // and never more often than one. The phase clock goes with it: without an
      // animated line it is the only sign the wait is still moving.
      if (options.heartbeat && next.message !== lastMessage && Date.now() - lastLoggedAt >= options.heartbeat) {
        log(`${next.message} ${styleText('dim', `(${formatElapsed(next, 0)})`)}`, next.message)
      }
    },
    stop() {
      stopped = true
      restore()
    },
  }
}
