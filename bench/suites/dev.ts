import type { Fixture, Target } from '../lib/targets.ts'
import process from 'node:process'
import { start, waitForHttp } from '../lib/proc.ts'
import { formatDelta, formatMs, markdownTable, summarise } from '../lib/stats.ts'
import { clearBuildCache, shortLabel } from '../lib/targets.ts'

let nextPort = 31_000

export function allocatePort(): number {
  return nextPort++
}

export interface DevSample {
  fixture: string
  mode: 'cold' | 'warm'
  target: string
  bound: number
  ready: number
  firstResponse: number
}

interface DevMeasurement {
  bound: number
  ready: number
  firstResponse: number
}

async function measureDevStart(target: Target, fixture: Fixture, cold: boolean, extraArgs: string[] = []): Promise<DevMeasurement> {
  if (cold) {
    clearBuildCache(fixture.dir)
  }
  const port = allocatePort()
  const server = start(process.execPath, [target.bin, 'dev', '--port', String(port), '--no-clear', ...extraArgs], {
    cwd: fixture.dir,
    env: { NO_COLOR: '1', NUXT_TELEMETRY_DISABLED: '1', CI: '1' },
  })
  const spawnedAt = performance.now()
  try {
    // The URL is printed when the socket binds, long before the app can answer.
    const bound = await server.waitFor(new RegExp(`localhost:${port}`))
    const ready = await server.waitFor(/ready in/i)
    const firstResponse = await waitForHttp(`http://localhost:${port}/`, spawnedAt)
    return { bound, ready, firstResponse }
  }
  finally {
    await server.stop()
  }
}

export async function devSuite(targets: Target[], fixtures: Fixture[], reps: number): Promise<{ results: DevSample[], markdown: string }> {
  const results: DevSample[] = []
  const rows: string[][] = []

  for (const fixture of fixtures) {
    for (const mode of ['cold', 'warm'] as const) {
      const samples = new Map<string, DevSample[]>(targets.map(t => [t.id, []]))
      if (mode === 'warm') {
        for (const target of targets) {
          await measureDevStart(target, fixture, false)
        }
      }
      for (let rep = 0; rep < reps; rep++) {
        for (const target of targets) {
          const measurement = await measureDevStart(target, fixture, mode === 'cold')
          samples.get(target.id)!.push({ fixture: fixture.id, mode, target: target.id, ...measurement })
        }
      }
      const summaries = targets.map((target) => {
        const entries = samples.get(target.id)!
        results.push(...entries)
        return {
          bound: summarise(entries.map(e => e.bound)),
          ready: summarise(entries.map(e => e.ready)),
          firstResponse: summarise(entries.map(e => e.firstResponse)),
        }
      })
      const [baseline, head] = summaries
      for (const [label, key] of [['socket bound', 'bound'], ['ready', 'ready'], ['first 200 response', 'firstResponse']] as const) {
        rows.push([
          `${fixture.id} / ${mode} / ${label}`,
          formatMs(baseline![key].median),
          formatMs(head![key].median),
          formatDelta(baseline![key].median, head![key].median),
          `${formatMs(baseline![key].min)} / ${formatMs(baseline![key].max)}`,
          `${formatMs(head![key].min)} / ${formatMs(head![key].max)}`,
        ])
      }
    }
  }

  const markdown = [
    `Median of ${reps} interleaved runs, from process spawn. "Socket bound" is the first URL printed, which happens as soon as the server can accept a connection; "ready" is the line the CLI prints once the app is built; "first 200 response" is a successful \`GET /\`. Cold runs delete \`.nuxt\`, \`.data\`, \`.output\` and \`node_modules/.cache\` first.`,
    '',
    markdownTable(
      ['Fixture / mode / metric', `${shortLabel(targets[0]!)} median`, `${shortLabel(targets[1]!)} median`, 'Delta', `${shortLabel(targets[0]!)} min / max`, `${shortLabel(targets[1]!)} min / max`],
      rows,
    ),
  ].join('\n')

  return { results, markdown }
}
