import type { FootprintResult } from './suites/footprint.ts'
import type { ModuleCount } from './suites/modules.ts'
import type { StartupResult } from './suites/startup.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { environment, gitDescribe } from './lib/env.ts'
import { formatBytes, formatDelta, formatMs, markdownTable } from './lib/stats.ts'
import { DEFAULT_BASELINE, prepareFixtures, prepareTargets, repoRoot, shortLabel } from './lib/targets.ts'
import { buildSuite } from './suites/build.ts'
import { devSuite } from './suites/dev.ts'
import { footprintSuite } from './suites/footprint.ts'
import { modulesSuite } from './suites/modules.ts'
import { restartSuite } from './suites/restart.ts'
import { startupSuite } from './suites/startup.ts'

const ALL_SUITES = ['startup', 'modules', 'dev', 'restart', 'build', 'footprint'] as const
type SuiteName = typeof ALL_SUITES[number]

const { values } = parseArgs({
  options: {
    'suite': { type: 'string', multiple: true, default: [...ALL_SUITES] },
    'baseline': { type: 'string', default: DEFAULT_BASELINE },
    'fixture': { type: 'string', multiple: true, default: ['playground', 'large'] },
    'workdir': { type: 'string', default: join(homedir(), '.cache', 'nuxt-cli-bench') },
    'out': { type: 'string', default: join(repoRoot, 'bench/results/report.md') },
    'startup-reps': { type: 'string', default: '15' },
    'dev-reps': { type: 'string', default: '5' },
    'restart-reps': { type: 'string', default: '5' },
    'build-reps': { type: 'string', default: '3' },
    'install-reps': { type: 'string', default: '3' },
  },
})

const suites = new Set(values.suite as SuiteName[])
for (const suite of suites) {
  if (!ALL_SUITES.includes(suite)) {
    throw new Error(`unknown suite ${suite}, expected one of ${ALL_SUITES.join(', ')}`)
  }
}

const workdir = values.workdir!
mkdirSync(workdir, { recursive: true })

console.log(`workdir: ${workdir}`)
const targets = prepareTargets(workdir, values.baseline!)
const needsFixtures = suites.has('dev') || suites.has('restart') || suites.has('build')
const fixtures = needsFixtures ? prepareFixtures(workdir).filter(fixture => values.fixture!.includes(fixture.id)) : []
if (needsFixtures && fixtures.length === 0) {
  throw new Error(`no fixtures matched ${values.fixture!.join(', ')}; the dev, restart and build suites need at least one`)
}
for (const target of targets) {
  console.log(`target ${target.id}: ${target.spec} -> v${target.version}`)
}

const env = environment()
const sections: string[] = []
const json: Record<string, unknown> = { environment: env, commit: gitDescribe(repoRoot), targets }

let startupResults: StartupResult[] | undefined
let moduleResults: ModuleCount[] | undefined
let footprintResults: FootprintResult[] | undefined

if (suites.has('startup')) {
  console.log('running startup suite')
  const { markdown, results } = await startupSuite(targets, Number(values['startup-reps']), workdir)
  json.startup = startupResults = results
  sections.push(`## Cold CLI startup\n\n${markdown}`)
}

if (suites.has('modules')) {
  console.log('running module load suite')
  const { markdown, results } = await modulesSuite(targets, workdir)
  json.modules = moduleResults = results
  sections.push(`## Module load cost\n\n${markdown}`)
}

if (suites.has('dev')) {
  console.log('running dev suite')
  const { markdown, results } = await devSuite(targets, fixtures, Number(values['dev-reps']))
  json.dev = results
  sections.push(`## \`nuxt dev\` time to ready\n\n${markdown}`)
}

if (suites.has('restart')) {
  console.log('running restart suite')
  const { markdown, results, noop } = await restartSuite(targets, fixtures[0]!, Number(values['restart-reps']))
  json.restart = { samples: results, noop }
  sections.push(`## Dev server restart latency\n\n${markdown}`)
}

if (suites.has('build')) {
  console.log('running build suite')
  const { markdown, results } = await buildSuite(targets, fixtures, Number(values['build-reps']))
  json.build = results
  sections.push(`## \`nuxt build\`\n\n${markdown}`)
}

if (suites.has('footprint')) {
  console.log('running footprint suite')
  const { markdown, results } = await footprintSuite(targets, workdir, Number(values['install-reps']))
  json.footprint = footprintResults = results
  sections.push(`## Install footprint and published tarball\n\n${markdown}`)
}

const header = [
  `# \`@nuxt/cli\` v${targets[0]!.version} (baseline) vs v${targets[1]!.version} (head)`,
  '',
  markdownTable(['Setting', 'Value'], [
    ['Baseline', `\`${targets[0]!.spec}\` (v${targets[0]!.version})`],
    ['Head', `local \`packages/nuxt-cli\` at \`${json.commit}\` (v${targets[1]!.version})`],
    ['Node', env.node],
    ['OS', `${env.os} (kernel ${env.kernel})`],
    ['CPU', `${env.cpu || 'unknown model'} x ${env.cores}`],
    ['Memory', env.memory],
    ['Load average at start', env.loadAverage],
    ['Run started', env.date],
  ]),
  ...(fixtures.length
    ? ['', 'Fixtures:', '', ...fixtures.map(fixture => `- \`${fixture.id}\`: ${fixture.label}`)]
    : []),
].join('\n')

const STARTUP_CASES: [id: string, label: string][] = [
  ['version', '`nuxt --version`'],
  ['help', '`nuxt --help`'],
  ['dev-help', '`nuxt dev --help`'],
]

const headlineRows: string[][] = []
for (const [caseId, label] of STARTUP_CASES) {
  const baseline = startupResults?.find(r => r.case === caseId && r.target === 'baseline')
  const head = startupResults?.find(r => r.case === caseId && r.target === 'head')
  if (baseline && head) {
    headlineRows.push([`${label} wall time (median)`, formatMs(baseline.wall.median), formatMs(head.wall.median), formatDelta(baseline.wall.median, head.wall.median)])
  }
}
for (const [caseId, label] of STARTUP_CASES) {
  const baseline = moduleResults?.find(r => r.case === caseId && r.target === 'baseline')
  const head = moduleResults?.find(r => r.case === caseId && r.target === 'head')
  if (baseline && head) {
    headlineRows.push([`${label} modules loaded`, String(baseline.modules), String(head.modules), formatDelta(baseline.modules, head.modules)])
  }
}
if (footprintResults) {
  const [baseline, head] = footprintResults
  headlineRows.push(
    ['Installed `node_modules`', formatBytes(baseline!.bytes), formatBytes(head!.bytes), formatDelta(baseline!.bytes, head!.bytes)],
    ['Published tarball (packed)', formatBytes(baseline!.tarballBytes), formatBytes(head!.tarballBytes), formatDelta(baseline!.tarballBytes, head!.tarballBytes)],
  )
}

const report = `${[header, ...sections].join('\n\n')}\n`
mkdirSync(dirname(values.out!), { recursive: true })
writeFileSync(values.out!, report)
writeFileSync(values.out!.replace(/\.md$/, '.json'), `${JSON.stringify(json, null, 2)}\n`)
if (headlineRows.length) {
  const summary = [
    `\`@nuxt/cli\` v${targets[0]!.version} (baseline) vs v${targets[1]!.version} (this PR)`,
    '',
    markdownTable(['Metric', shortLabel(targets[0]!), shortLabel(targets[1]!), 'Delta'], headlineRows),
    '',
  ].join('\n')
  writeFileSync(join(dirname(values.out!), 'summary.md'), summary)
}
console.log(`wrote ${values.out}`)
process.exit(0)
