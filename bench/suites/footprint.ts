import type { Target } from '../lib/targets.ts'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatBytes, formatDelta, formatMs, markdownTable, summarise } from '../lib/stats.ts'
import { directorySize, npm, shortLabel } from '../lib/targets.ts'

export interface FootprintResult {
  target: string
  bytes: number
  files: number
  packages: number
  uniqueNames: number
  installedDirs: number
  directPackages: number
  installMedianMs: number
  tarballBytes: number
  unpackedBytes: number
  tarballFiles: number
}

interface Tree {
  version?: string
  resolved?: string
  dependencies?: Record<string, Tree>
}

function countTree(target: Target): { packages: number, uniqueNames: number } {
  const output = npm(['ls', '--all', '--json'], target.dir)
  const root = JSON.parse(output) as Tree
  const seen = new Set<string>()
  const names = new Set<string>()
  const walk = (node: Tree) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      const id = `${name}@${child.version}`
      names.add(name)
      if (!seen.has(id)) {
        seen.add(id)
        walk(child)
      }
    }
  }
  walk(root)
  return { packages: seen.size, uniqueNames: names.size }
}

/** Cross-check for the `npm ls` tree walk: count real package directories on disk. */
function countInstalledDirectories(target: Target): number {
  const root = join(target.dir, 'node_modules')
  let count = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') {
        continue
      }
      if (entry.name.startsWith('@')) {
        walk(join(dir, entry.name))
        continue
      }
      count++
      const nested = join(dir, entry.name, 'node_modules')
      try {
        if (statSync(nested).isDirectory()) {
          walk(nested)
        }
      }
      catch {
        // no nested tree
      }
    }
  }
  walk(root)
  return count
}

function tarballStats(target: Target, workdir: string): { tarballBytes: number, unpackedBytes: number, tarballFiles: number } {
  const packageDir = join(target.dir, 'node_modules/@nuxt/cli')
  const output = execFileSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts', '--pack-destination', workdir], { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const [entry] = JSON.parse(output) as { size: number, unpackedSize: number, entryCount: number }[]
  return { tarballBytes: entry!.size, unpackedBytes: entry!.unpackedSize, tarballFiles: entry!.entryCount }
}

function directDependencies(target: Target): number {
  const pkg = JSON.parse(readFileSync(join(target.dir, 'node_modules/@nuxt/cli/package.json'), 'utf8'))
  return Object.keys(pkg.dependencies ?? {}).length
}

export async function footprintSuite(targets: Target[], workdir: string, reps: number): Promise<{ results: FootprintResult[], markdown: string }> {
  const installSamples = new Map<string, number[]>(targets.map(t => [t.id, []]))

  for (let rep = 0; rep < reps; rep++) {
    for (const target of targets) {
      rmSync(join(target.dir, 'node_modules'), { recursive: true, force: true })
      rmSync(join(target.dir, 'package-lock.json'), { force: true })
      const started = performance.now()
      npm(['install', '--no-audit', '--no-fund', '--prefer-offline'], target.dir)
      installSamples.get(target.id)!.push(performance.now() - started)
    }
  }

  const results: FootprintResult[] = []
  for (const target of targets) {
    const size = directorySize(join(target.dir, 'node_modules'))
    const counts = countTree(target)
    results.push({
      target: target.id,
      bytes: size.bytes,
      files: size.files,
      packages: counts.packages,
      uniqueNames: counts.uniqueNames,
      installedDirs: countInstalledDirectories(target),
      directPackages: directDependencies(target),
      installMedianMs: summarise(installSamples.get(target.id)!).median,
      ...tarballStats(target, workdir),
    })
  }

  const [baseline, head] = results
  const rows = [
    ['Direct dependencies of `@nuxt/cli`', String(baseline!.directPackages), String(head!.directPackages), formatDelta(baseline!.directPackages, head!.directPackages)],
    ['Packages in the installed tree (unique name@version)', String(baseline!.packages), String(head!.packages), formatDelta(baseline!.packages, head!.packages)],
    ['Unique package names', String(baseline!.uniqueNames), String(head!.uniqueNames), formatDelta(baseline!.uniqueNames, head!.uniqueNames)],
    ['Package directories on disk (cross-check)', String(baseline!.installedDirs), String(head!.installedDirs), formatDelta(baseline!.installedDirs, head!.installedDirs)],
    ['Installed `node_modules` on disk', formatBytes(baseline!.bytes), formatBytes(head!.bytes), formatDelta(baseline!.bytes, head!.bytes)],
    ['Installed files', String(baseline!.files), String(head!.files), formatDelta(baseline!.files, head!.files)],
    [`Install wall time (warm npm cache, median of ${reps})`, formatMs(baseline!.installMedianMs), formatMs(head!.installMedianMs), formatDelta(baseline!.installMedianMs, head!.installMedianMs)],
    ['Published tarball (packed)', formatBytes(baseline!.tarballBytes), formatBytes(head!.tarballBytes), formatDelta(baseline!.tarballBytes, head!.tarballBytes)],
    ['Published tarball (unpacked)', formatBytes(baseline!.unpackedBytes), formatBytes(head!.unpackedBytes), formatDelta(baseline!.unpackedBytes, head!.unpackedBytes)],
    ['Files in tarball', String(baseline!.tarballFiles), String(head!.tarballFiles), formatDelta(baseline!.tarballFiles, head!.tarballFiles)],
  ]

  const markdown = [
    'Each version installed on its own into an empty project with nothing but `@nuxt/cli` as a dependency, so the tree is exactly the CLI and its transitive dependencies. npm cache is warm and the registry is only consulted for metadata, so install wall time is indicative, not a network benchmark.',
    '',
    markdownTable(['Metric', shortLabel(targets[0]!), shortLabel(targets[1]!), 'Delta'], rows),
  ].join('\n')

  return { results, markdown }
}
