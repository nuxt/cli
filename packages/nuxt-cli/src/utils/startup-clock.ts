/**
 * Time spent away from actual startup work: interactive prompts, dependency
 * installs, taking over another server, one-time tool downloads. The reported
 * time-to-ready subtracts it, so `ready in 800ms` describes the server rather
 * than how long a question sat on screen.
 */

let excludedMs = 0
let pausedAt: number | undefined
let depth = 0

function pauseStartupClock(): void {
  if (depth++ === 0) {
    pausedAt = Date.now()
  }
}

function resumeStartupClock(): void {
  if (depth > 0 && --depth === 0 && pausedAt !== undefined) {
    excludedMs += Date.now() - pausedAt
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

/** Milliseconds since `since`, not counting paused stretches. */
export function startupElapsedMs(since: number): number {
  const open = pausedAt === undefined ? 0 : Date.now() - pausedAt
  return Math.max(0, Date.now() - since - excludedMs - open)
}
