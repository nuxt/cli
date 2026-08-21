import type { Target } from '../lib/targets.ts'
import process from 'node:process'
import { run } from '../lib/proc.ts'
import { formatDelta, formatMs, markdownTable, summarise } from '../lib/stats.ts'
import { shortLabel } from '../lib/targets.ts'

const CASES = [
  { id: 'version', label: '`nuxt --version`', args: ['--version'] },
  { id: 'help', label: '`nuxt --help`', args: ['--help'] },
  { id: 'dev-help', label: '`nuxt dev --help`', args: ['dev', '--help'] },
  { id: 'unknown', label: '`nuxt <unknown-command>` (no-op)', args: ['definitely-not-a-command'] },
] as const

export interface StartupResult {
  case: string
  target: string
  wall: ReturnType<typeof summarise>
  ttfb?: ReturnType<typeof summarise>
}

export async function startupSuite(targets: Target[], reps: number, cwd: string): Promise<{ results: StartupResult[], markdown: string }> {
  const samples = new Map<string, { wall: number[], ttfb: number[] }>()
  const key = (caseId: string, targetId: string) => `${caseId}:${targetId}`

  for (const testCase of CASES) {
    for (const target of targets) {
      samples.set(key(testCase.id, target.id), { wall: [], ttfb: [] })
      await run(process.execPath, [target.bin, ...testCase.args], { cwd })
    }
  }

  for (let rep = 0; rep < reps; rep++) {
    for (const testCase of CASES) {
      for (const target of targets) {
        const result = await run(process.execPath, [target.bin, ...testCase.args], { cwd })
        const entry = samples.get(key(testCase.id, target.id))!
        entry.wall.push(result.wall)
        if (!Number.isNaN(result.ttfb)) {
          entry.ttfb.push(result.ttfb)
        }
      }
    }
  }

  const results: StartupResult[] = []
  const rows: string[][] = []
  for (const testCase of CASES) {
    const summaries = targets.map((target) => {
      const entry = samples.get(key(testCase.id, target.id))!
      const summary = { case: testCase.id, target: target.id, wall: summarise(entry.wall), ttfb: entry.ttfb.length ? summarise(entry.ttfb) : undefined }
      results.push(summary)
      return summary
    })
    const [baseline, head] = summaries
    rows.push([
      testCase.label,
      `${formatMs(baseline!.wall.median)}`,
      `${formatMs(head!.wall.median)}`,
      formatDelta(baseline!.wall.median, head!.wall.median),
      `${formatMs(baseline!.wall.min)} / ${formatMs(baseline!.wall.p95)}`,
      `${formatMs(head!.wall.min)} / ${formatMs(head!.wall.p95)}`,
    ])
    if (baseline?.ttfb && head?.ttfb) {
      rows.push([
        `${testCase.label} (first output byte)`,
        `${formatMs(baseline.ttfb.median)}`,
        `${formatMs(head.ttfb.median)}`,
        formatDelta(baseline.ttfb.median, head.ttfb.median),
        `${formatMs(baseline.ttfb.min)} / ${formatMs(baseline.ttfb.p95)}`,
        `${formatMs(head.ttfb.min)} / ${formatMs(head.ttfb.p95)}`,
      ])
    }
  }

  const markdown = [
    `Median of ${reps} interleaved runs per command, one warmup discarded.`,
    '',
    markdownTable(
      ['Command', `${shortLabel(targets[0]!)} median`, `${shortLabel(targets[1]!)} median`, 'Delta', `${shortLabel(targets[0]!)} min / p95`, `${shortLabel(targets[1]!)} min / p95`],
      rows,
    ),
  ].join('\n')

  return { results, markdown }
}
