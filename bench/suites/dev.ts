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
  ready: number
  firstResponse: number
}

interface DevMeasurement {
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
    const ready = await server.waitFor(new RegExp(`localhost:${port}`))
    const firstResponse = await waitForHttp(`http://localhost:${port}/`, spawnedAt)
    return { ready, firstResponse }
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
          ready: summarise(entries.map(e => e.ready)),
          firstResponse: summarise(entries.map(e => e.firstResponse)),
        }
      })
      const [baseline, head] = summaries
      rows.push([
        `${fixture.id} / ${mode} / ready`,
        formatMs(baseline!.ready.median),
        formatMs(head!.ready.median),
        formatDelta(baseline!.ready.median, head!.ready.median),
        `${formatMs(baseline!.ready.min)} / ${formatMs(baseline!.ready.max)}`,
        `${formatMs(head!.ready.min)} / ${formatMs(head!.ready.max)}`,
      ])
      rows.push([
        `${fixture.id} / ${mode} / first 200 response`,
        formatMs(baseline!.firstResponse.median),
        formatMs(head!.firstResponse.median),
        formatDelta(baseline!.firstResponse.median, head!.firstResponse.median),
        `${formatMs(baseline!.firstResponse.min)} / ${formatMs(baseline!.firstResponse.max)}`,
        `${formatMs(head!.firstResponse.min)} / ${formatMs(head!.firstResponse.max)}`,
      ])
    }
  }

  const markdown = [
    `Median of ${reps} interleaved runs. "ready" is the first URL printed by the CLI, "first 200 response" is measured from process spawn to a successful \`GET /\`. Cold runs delete \`.nuxt\`, \`.data\`, \`.output\` and \`node_modules/.cache\` first.`,
    '',
    markdownTable(
      ['Fixture / mode / metric', `${shortLabel(targets[0]!)} median`, `${shortLabel(targets[1]!)} median`, 'Delta', `${shortLabel(targets[0]!)} min / max`, `${shortLabel(targets[1]!)} min / max`],
      rows,
    ),
  ].join('\n')

  return { results, markdown }
}
