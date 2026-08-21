import type { Fixture, Target } from '../lib/targets.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { start } from '../lib/proc.ts'
import { formatDelta, formatMs, markdownTable, summarise } from '../lib/stats.ts'
import { shortLabel } from '../lib/targets.ts'
import { allocatePort } from './dev.ts'

export interface RestartSample {
  scenario: string
  target: string
  notice: number
  serving: number
}

export interface NoopResult {
  target: string
  restarted: boolean
  waitedMs: number
}

const SCENARIOS = [
  { id: 'config change, warmed fork pool', args: [] as string[] },
  { id: 'config change, `--no-fork`', args: ['--no-fork'] },
]

function configFor(marker: number): string {
  return [
    `export default defineNuxtConfig({`,
    `  compatibilityDate: '2024-09-05',`,
    `  runtimeConfig: {`,
    `    public: {`,
    `      benchMarker: ${marker},`,
    `    },`,
    `  },`,
    `})`,
    ``,
  ].join('\n')
}

async function markerValue(port: number): Promise<number | undefined> {
  try {
    const response = await fetch(`http://localhost:${port}/__bench`)
    if (!response.ok) {
      return undefined
    }
    return Number(await response.text())
  }
  catch {
    return undefined
  }
}

async function waitForMarker(port: number, expected: number, since: number, timeout = 180_000): Promise<number> {
  while (performance.now() - since < timeout) {
    if (await markerValue(port) === expected) {
      return performance.now() - since
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for marker ${expected} on port ${port}`)
}

async function measureRestart(target: Target, fixture: Fixture, args: string[], reps: number): Promise<RestartSample[]> {
  const configPath = join(fixture.dir, 'nuxt.config.ts')
  const original = readFileSync(configPath, 'utf8')
  const port = allocatePort()
  const samples: RestartSample[] = []
  writeFileSync(configPath, configFor(0))
  const server = start(process.execPath, [target.bin, 'dev', '--port', String(port), '--no-clear', ...args], {
    cwd: fixture.dir,
    env: { NO_COLOR: '1', NUXT_TELEMETRY_DISABLED: '1', CI: '1' },
  })
  try {
    await server.waitFor(new RegExp(`localhost:${port}`))
    await waitForMarker(port, 0, performance.now())

    for (let rep = 1; rep <= reps; rep++) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      server.resetClock()
      const changedAt = performance.now()
      writeFileSync(configPath, configFor(rep))
      const notice = await server.waitFor(/\S/, 60_000)
      const serving = await waitForMarker(port, rep, changedAt)
      samples.push({ scenario: args.join(' ') || 'fork', target: target.id, notice, serving })
    }
  }
  finally {
    writeFileSync(configPath, original)
    await server.stop()
  }
  return samples
}

async function measureNoopSave(target: Target, fixture: Fixture, waitMs: number): Promise<NoopResult> {
  const configPath = join(fixture.dir, 'nuxt.config.ts')
  const original = readFileSync(configPath, 'utf8')
  const port = allocatePort()
  writeFileSync(configPath, configFor(0))
  const server = start(process.execPath, [target.bin, 'dev', '--port', String(port), '--no-clear'], {
    cwd: fixture.dir,
    env: { NO_COLOR: '1', NUXT_TELEMETRY_DISABLED: '1', CI: '1' },
  })
  try {
    await server.waitFor(new RegExp(`localhost:${port}`))
    await waitForMarker(port, 0, performance.now())
    await new Promise(resolve => setTimeout(resolve, 1500))
    server.resetClock()
    writeFileSync(configPath, configFor(0))
    try {
      await server.waitFor(/\S/, waitMs)
      return { target: target.id, restarted: true, waitedMs: waitMs }
    }
    catch {
      return { target: target.id, restarted: false, waitedMs: waitMs }
    }
  }
  finally {
    writeFileSync(configPath, original)
    await server.stop()
  }
}

export async function restartSuite(targets: Target[], fixture: Fixture, reps: number): Promise<{ results: RestartSample[], noop: NoopResult[], markdown: string }> {
  const results: RestartSample[] = []
  const rows: string[][] = []

  for (const scenario of SCENARIOS) {
    const perTarget = new Map<string, RestartSample[]>()
    for (const target of targets) {
      const samples = await measureRestart(target, fixture, scenario.args, reps)
      perTarget.set(target.id, samples)
      results.push(...samples.map(sample => ({ ...sample, scenario: scenario.id })))
    }
    const summaries = targets.map(target => ({
      notice: summarise(perTarget.get(target.id)!.map(s => s.notice)),
      serving: summarise(perTarget.get(target.id)!.map(s => s.serving)),
    }))
    const [baseline, head] = summaries
    rows.push([
      `${scenario.id} / noticed`,
      formatMs(baseline!.notice.median),
      formatMs(head!.notice.median),
      formatDelta(baseline!.notice.median, head!.notice.median),
      `${formatMs(baseline!.notice.min)} / ${formatMs(baseline!.notice.max)}`,
      `${formatMs(head!.notice.min)} / ${formatMs(head!.notice.max)}`,
    ])
    rows.push([
      `${scenario.id} / serving new config`,
      formatMs(baseline!.serving.median),
      formatMs(head!.serving.median),
      formatDelta(baseline!.serving.median, head!.serving.median),
      `${formatMs(baseline!.serving.min)} / ${formatMs(baseline!.serving.max)}`,
      `${formatMs(head!.serving.min)} / ${formatMs(head!.serving.max)}`,
    ])
  }

  const noop = []
  for (const target of targets) {
    noop.push(await measureNoopSave(target, fixture, 8000))
  }

  const markdown = [
    `Median of ${reps} restarts per scenario on the \`${fixture.id}\` fixture, one long-lived dev server per scenario. During this suite \`nuxt.config.ts\` is replaced with a generated config carrying a counter in \`runtimeConfig.public\`, and the fixture exposes it at \`/__bench\`. "noticed" is the first output after the write, "serving new config" is the first request that comes back with the new counter, so it is a true end-to-end restart measurement rather than a log line.`,
    '',
    markdownTable(
      ['Scenario', `${shortLabel(targets[0]!)} median`, `${shortLabel(targets[1]!)} median`, 'Delta', `${shortLabel(targets[0]!)} min / max`, `${shortLabel(targets[1]!)} min / max`],
      rows,
    ),
    '',
    'Rewriting `nuxt.config.ts` with byte-identical content, then watching for 8 s:',
    '',
    markdownTable(
      ['Version', 'Any restart activity on a no-op save?'],
      noop.map((entry, index) => [shortLabel(targets[index]!), entry.restarted ? 'yes' : 'no']),
    ),
  ].join('\n')

  return { results, noop, markdown }
}
