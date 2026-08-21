import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { run } from './lib/proc.ts'
import { formatDelta, formatMs, markdownTable, summarise } from './lib/stats.ts'

/**
 * Interleaved startup comparison between arbitrary local builds, for answering
 * "did this patch cost anything" without going through the full suite.
 *
 * Usage: `node --experimental-strip-types bench/ab.ts --bin with=/path/bin/nuxi.mjs --bin without=/other/bin/nuxi.mjs --case --version`
 */
const { values } = parseArgs({
  options: {
    bin: { type: 'string', multiple: true, default: [] },
    case: { type: 'string', multiple: true, default: ['--version'] },
    reps: { type: 'string', default: '31' },
    cwd: { type: 'string', default: join(homedir(), '.cache', 'nuxt-cli-bench') },
  },
})

const bins = values.bin!.map((entry) => {
  const index = entry.indexOf('=')
  if (index === -1) {
    throw new Error(`expected --bin label=/path/to/bin/nuxi.mjs, got "${entry}"`)
  }
  return { label: entry.slice(0, index), path: entry.slice(index + 1) }
})
if (bins.length < 2) {
  throw new Error('pass at least two --bin label=path entries')
}

const reps = Number(values.reps)

async function main(): Promise<void> {
  const samples = new Map<string, number[]>()

  for (const testCase of values.case!) {
    for (const bin of bins) {
      samples.set(`${testCase}:${bin.label}`, [])
      await run(process.execPath, [bin.path, ...testCase.split(' ')], { cwd: values.cwd })
    }
  }

  for (let rep = 0; rep < reps; rep++) {
    for (const testCase of values.case!) {
      for (const bin of bins) {
        const result = await run(process.execPath, [bin.path, ...testCase.split(' ')], { cwd: values.cwd })
        samples.get(`${testCase}:${bin.label}`)!.push(result.wall)
      }
    }
  }

  const rows: string[][] = []
  for (const testCase of values.case!) {
    const first = summarise(samples.get(`${testCase}:${bins[0]!.label}`)!)
    for (const bin of bins) {
      const summary = summarise(samples.get(`${testCase}:${bin.label}`)!)
      rows.push([
        `\`nuxt ${testCase}\``,
        bin.label,
        formatMs(summary.median),
        formatMs(summary.min),
        formatMs(summary.p95),
        bin.label === bins[0]!.label ? 'reference' : formatDelta(first.median, summary.median),
      ])
    }
  }

  console.log(markdownTable(['Case', 'Build', 'Median', 'Min', 'p95', 'vs reference'], rows))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
