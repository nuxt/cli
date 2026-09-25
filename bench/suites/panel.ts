import type { Fixture, Target } from '../lib/targets.ts'

import { record } from '../../capture/lib/pty.ts'
import { formatDelta, formatMs, markdownTable, summarise } from '../lib/stats.ts'
import { shortLabel } from '../lib/targets.ts'
import { allocatePort } from './dev.ts'

/** Wide and tall enough that the panel is not refused for want of room. */
const COLUMNS = 100
const ROWS = 30

/** How often a keypress is offered until one is answered. */
const KEY_INTERVAL_MS = 20

export interface PanelSample {
  fixture: string
  target: string
  /** Time to the first thing a user can see, rather than the first byte. */
  firstPaint: number
  /** Time until a key pressed at the first frame is answered. */
  interactive: number
}

interface PanelMeasurement {
  firstPaint: number
  interactive: number
}

/** Whether a chunk puts something on screen, rather than moving the cursor. */
function isVisible(text: string): boolean {
  const printable = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\[[0-9;?]*[a-z]/gi, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)?/g, '')
  // eslint-disable-next-line no-control-regex
  return /[^\s\u0000-\u001F\u007F]/.test(printable)
}

/**
 * Time the two moments before a `nuxt dev` serves anything: when the panel
 * appears, and when it first answers the keyboard.
 *
 * `?` is offered until the help view answers, since a key pressed before the
 * panel takes stdin may be dropped.
 */
async function measurePanel(target: Target, fixture: Fixture): Promise<PanelMeasurement> {
  const port = allocatePort()
  const session = record(`exec ${process.execPath} ${target.bin} dev --port ${port}`, {
    cwd: fixture.dir,
    columns: COLUMNS,
    rows: ROWS,
    env: { NUXT_TELEMETRY_DISABLED: '1', NUXT_IGNORE_LOCK: '1' },
  })

  let keys: NodeJS.Timeout | undefined
  try {
    const painted = session.chunks.find(chunk => isVisible(chunk.data))
      ?? await new Promise<{ at: number }>((resolve, reject) => {
        const timer = setInterval(() => {
          const chunk = session.chunks.find(entry => isVisible(entry.data))
          if (chunk) {
            clearInterval(timer)
            resolve(chunk)
          }
        }, 5)
        session.exited.then(() => {
          clearInterval(timer)
          reject(new Error(`the session ended before it painted:\n${session.output().slice(-800)}`))
        }, reject)
      })

    session.send('?')
    keys = setInterval(() => session.send('?'), KEY_INTERVAL_MS)
    await session.waitFor(/keyboard shortcuts/)
    const answered = session.chunks.find(chunk => chunk.data.includes('keyboard shortcuts'))!

    return { firstPaint: painted.at, interactive: answered.at }
  }
  finally {
    clearInterval(keys)
    await session.stop()
  }
}

export async function panelSuite(targets: Target[], fixtures: Fixture[], reps: number): Promise<{ results: PanelSample[], markdown: string }> {
  const results: PanelSample[] = []
  const rows: string[][] = []

  for (const fixture of fixtures) {
    const samples = new Map<string, PanelSample[]>(targets.map(target => [target.id, []]))
    for (const target of targets) {
      await measurePanel(target, fixture)
    }
    for (let rep = 0; rep < reps; rep++) {
      for (const target of targets) {
        const measurement = await measurePanel(target, fixture)
        samples.get(target.id)!.push({ fixture: fixture.id, target: target.id, ...measurement })
      }
    }
    const summaries = targets.map((target) => {
      const entries = samples.get(target.id)!
      results.push(...entries)
      return {
        firstPaint: summarise(entries.map(entry => entry.firstPaint)),
        interactive: summarise(entries.map(entry => entry.interactive)),
      }
    })
    const [baseline, head] = summaries
    for (const [label, key] of [['first paint', 'firstPaint'], ['first answered keypress', 'interactive']] as const) {
      rows.push([
        `${fixture.id} / ${label}`,
        formatMs(baseline![key].median),
        formatMs(head![key].median),
        formatDelta(baseline![key].median, head![key].median),
        `${formatMs(baseline![key].min)} / ${formatMs(baseline![key].max)}`,
        `${formatMs(head![key].min)} / ${formatMs(head![key].max)}`,
      ])
    }
  }

  const markdown = [
    `Median of ${reps} interleaved runs in a ${COLUMNS}x${ROWS} pty, one warmup discarded. "First paint" is the first chunk carrying printable content, so cursor moves and the room the panel makes for itself do not count. "First answered keypress" offers \`?\` every ${KEY_INTERVAL_MS}ms from the first paint and waits for the help view.`,
    '',
    markdownTable(
      ['Fixture / metric', `${shortLabel(targets[0]!)} median`, `${shortLabel(targets[1]!)} median`, 'Delta', `${shortLabel(targets[0]!)} min / max`, `${shortLabel(targets[1]!)} min / max`],
      rows,
    ),
  ].join('\n')

  return { results, markdown }
}
