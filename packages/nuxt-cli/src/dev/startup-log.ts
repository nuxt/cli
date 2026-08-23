import type { DevProgressSnapshot } from './progress'

import process from 'node:process'
import { styleText } from 'node:util'

import { isCI } from 'std-env'

import { formatDuration } from '../utils/formatting'
import { logger } from '../utils/logger'
import { tapOutput } from '../utils/stdout'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_INTERVAL = 80
const CLEAR_LINE = '\r\u001B[2K'
const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

export interface StartupReporter {
  update: (snapshot: DevProgressSnapshot) => void
  stop: () => void
}

interface StartupReporterOptions {
  stream?: NodeJS.WriteStream
  /** Force the animated line on or off; detected from the environment otherwise. */
  animated?: boolean
}

export function isAnimationSupported(stream: NodeJS.WriteStream = process.stdout): boolean {
  return !!stream.isTTY && !isCI && !process.env.NO_COLOR
}

export function formatSummary(snapshot: DevProgressSnapshot): string {
  const breakdown = snapshot.timings
    .filter(timing => timing.duration >= 10)
    .map(timing => `${timing.phase} ${formatDuration(timing.duration)}`)
    .join(' · ')
  const headline = `${snapshot.reload ? 'Reloaded' : 'Ready'} in ${formatDuration(snapshot.elapsed)}${
    snapshot.serving ? '' : styleText('dim', ' \u00B7 compiling the first request')}`
  return breakdown ? `${headline}\n${styleText('dim', breakdown)}` : headline
}

/**
 * Report startup progress on a single line that updates in place, collapsing to
 * one summary line with a phase breakdown once the server is ready. Falls back
 * to sequential logs when the output is not an interactive terminal.
 */
export function createStartupReporter(options: StartupReporterOptions = {}): StartupReporter {
  const stream = options.stream ?? process.stdout
  const animated = options.animated ?? isAnimationSupported(stream)

  let snapshot: DevProgressSnapshot | undefined
  let served = false
  let lastPhase: string | undefined
  let frame = 0
  let dirty = false
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let receivedAt = Date.now()

  // Foreign output would otherwise be written on top of the transient line. The
  // tap sits below `consola.wrapAll()`, which `nuxt dev` installs, for two
  // reasons: consola's reporter writes through `__write` and would not be seen
  // above it, and its wrapper trims each chunk and logs it as a line of its own,
  // which turns a line that redraws itself into one line per frame. Writing
  // through the tap's own handle also keeps the transient line invisible to this
  // listener and to the spacing tracker.
  const tap = animated ? tapOutput(stream, () => clear()) : undefined
  const write = tap?.write ?? stream.write.bind(stream)

  function clear() {
    if (dirty) {
      write(CLEAR_LINE)
      dirty = false
    }
  }

  function render() {
    if (!snapshot || stopped) {
      return
    }
    clear()
    const elapsed = styleText('dim', formatDuration(snapshot.elapsed + (Date.now() - receivedAt)))
    write(`${styleText('cyan', FRAMES[frame = (frame + 1) % FRAMES.length]!)} ${snapshot.message} ${elapsed}`)
    dirty = true
  }

  if (animated) {
    write(HIDE_CURSOR)
    timer = setInterval(render, FRAME_INTERVAL)
    timer.unref?.()
  }

  function restore() {
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
        logger.info(next.message)
      }
    },
    stop() {
      stopped = true
      restore()
    },
  }
}
