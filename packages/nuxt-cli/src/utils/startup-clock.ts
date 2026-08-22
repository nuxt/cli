/**
 * Time spent away from actual startup work: interactive prompts, dependency
 * installs, taking over another server, one-time tool downloads. The reported
 * time-to-ready subtracts it, so `ready in 800ms` describes the server rather
 * than how long a question sat on screen.
 */

/** Closed pauses, as `[start, end]`. Only a handful happen in a session. */
const pauses: Array<[number, number]> = []
let pausedAt: number | undefined
let depth = 0

function pauseStartupClock(): void {
  if (depth++ === 0) {
    pausedAt = Date.now()
  }
}

function resumeStartupClock(): void {
  if (depth > 0 && --depth === 0 && pausedAt !== undefined) {
    pauses.push([pausedAt, Date.now()])
    pausedAt = undefined
  }
}

/** Run `work` without its duration counting towards time-to-ready. */
export async function withStartupClockPaused<T>(work: () => Promise<T>): Promise<T> {
  pauseStartupClock()
  try {
    return await work()
  }
  finally {
    resumeStartupClock()
  }
}

/**
 * Milliseconds since `since`, not counting paused stretches.
 *
 * Only the part of a pause that falls after `since` is subtracted, so a
 * baseline taken after a prompt is not charged for the time it took to answer.
 */
export function startupElapsedMs(since: number): number {
  const now = Date.now()
  const open = pausedAt === undefined ? [] : [[pausedAt, now] as [number, number]]
  const excluded = [...pauses, ...open]
    .reduce((total, [start, end]) => total + Math.max(0, Math.min(end, now) - Math.max(start, since)), 0)
  return Math.max(0, now - since - excluded)
}
