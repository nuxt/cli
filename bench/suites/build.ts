import type { Fixture, Target } from '../lib/targets.ts'
import process from 'node:process'
import { run } from '../lib/proc.ts'
import { formatDelta, formatMs, markdownTable, summarise } from '../lib/stats.ts'
import { clearBuildCache, shortLabel } from '../lib/targets.ts'

export interface BuildSample {
  fixture: string
  target: string
  wall: number
}

export async function buildSuite(targets: Target[], fixtures: Fixture[], reps: number): Promise<{ results: BuildSample[], markdown: string }> {
  const results: BuildSample[] = []
  const rows: string[][] = []

  for (const fixture of fixtures) {
    const samples = new Map<string, number[]>(targets.map(t => [t.id, []]))
    for (let rep = 0; rep < reps; rep++) {
      for (const target of targets) {
        clearBuildCache(fixture.dir)
        const result = await run(process.execPath, [target.bin, 'build'], {
          cwd: fixture.dir,
          env: { NO_COLOR: '1', NUXT_TELEMETRY_DISABLED: '1', CI: '1' },
          timeout: 600_000,
        })
        if (result.code !== 0) {
          throw new Error(`build failed for ${target.id} on ${fixture.id}:\n${result.stderr.slice(-2000)}`)
        }
        samples.get(target.id)!.push(result.wall)
      }
    }
    const summaries = targets.map((target) => {
      const values = samples.get(target.id)!
      results.push(...values.map(wall => ({ fixture: fixture.id, target: target.id, wall })))
      return summarise(values)
    })
    const [baseline, head] = summaries
    rows.push([
      fixture.id,
      formatMs(baseline!.median),
      formatMs(head!.median),
      formatDelta(baseline!.median, head!.median),
      `${formatMs(baseline!.min)} / ${formatMs(baseline!.max)}`,
      `${formatMs(head!.min)} / ${formatMs(head!.max)}`,
    ])
  }

  const markdown = [
    `Median of ${reps} interleaved \`nuxt build\` runs per fixture, build caches deleted before every run.`,
    '',
    markdownTable(
      ['Fixture', `${shortLabel(targets[0]!)} median`, `${shortLabel(targets[1]!)} median`, 'Delta', `${shortLabel(targets[0]!)} min / max`, `${shortLabel(targets[1]!)} min / max`],
      rows,
    ),
  ].join('\n')

  return { results, markdown }
}
