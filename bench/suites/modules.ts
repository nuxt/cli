import type { Target } from '../lib/targets.ts'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { run } from '../lib/proc.ts'
import { formatBytes, formatDelta, markdownTable } from '../lib/stats.ts'
import { shortLabel } from '../lib/targets.ts'

const hook = fileURLToPath(new URL('../lib/module-hook.mjs', import.meta.url))

const CASES = [
  { id: 'version', label: '`nuxt --version`', args: ['--version'] },
  { id: 'help', label: '`nuxt --help`', args: ['--help'] },
  { id: 'dev-help', label: '`nuxt dev --help`', args: ['dev', '--help'] },
] as const

export interface ModuleCount {
  case: string
  target: string
  modules: number
  nodeModules: number
  bytes: number
}

export async function modulesSuite(targets: Target[], cwd: string): Promise<{ results: ModuleCount[], markdown: string }> {
  const results: ModuleCount[] = []
  const rows: string[][] = []

  for (const testCase of CASES) {
    const perTarget: ModuleCount[] = []
    for (const target of targets) {
      const result = await run(process.execPath, ['--import', hook, target.bin, ...testCase.args], {
        cwd,
        env: { NODE_DISABLE_COMPILE_CACHE: '1' },
      })
      const match = result.stderr.match(/__BENCH_MODULES__(\{.*\})/)
      if (!match) {
        throw new Error(`no module stats for ${target.id} ${testCase.id}:\n${result.stderr.slice(-2000)}`)
      }
      const parsed = JSON.parse(match[1]!) as { modules: number, nodeModules: number, bytes: number }
      const entry = { case: testCase.id, target: target.id, ...parsed }
      results.push(entry)
      perTarget.push(entry)
    }
    const [baseline, head] = perTarget
    rows.push([
      testCase.label,
      String(baseline!.modules),
      String(head!.modules),
      formatDelta(baseline!.modules, head!.modules),
      formatBytes(baseline!.bytes),
      formatBytes(head!.bytes),
      formatDelta(baseline!.bytes, head!.bytes),
    ])
  }

  const markdown = [
    'Counted with a `module.registerHooks` load hook, compile cache disabled. Counts every JS module actually evaluated on that code path (built-ins excluded, native addons excluded).',
    '',
    markdownTable(
      ['Command', `${shortLabel(targets[0]!)} modules`, `${shortLabel(targets[1]!)} modules`, 'Delta', `${shortLabel(targets[0]!)} source bytes`, `${shortLabel(targets[1]!)} source bytes`, 'Delta'],
      rows,
    ),
  ].join('\n')

  return { results, markdown }
}
