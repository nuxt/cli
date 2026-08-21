import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export interface Target {
  id: 'baseline' | 'head'
  label: string
  /** Directory holding an isolated `npm install` of just this `@nuxt/cli`. */
  dir: string
  /** Absolute path to `bin/nuxi.mjs` for this target. */
  bin: string
  version: string
  spec: string
}

export interface Fixture {
  id: string
  label: string
  dir: string
}

/** The published `@nuxt/cli` version to compare `packages/nuxt-cli` against. */
export const DEFAULT_BASELINE = 'latest'

/** Short name for table headers, e.g. `baseline v3.37.0`. */
export function shortLabel(target: Target): string {
  return `${target.id} v${target.version}`
}

export function prepareTargets(workdir: string, baselineSpec: string = DEFAULT_BASELINE): Target[] {
  mkdirSync(workdir, { recursive: true })

  const tarball = packHead(workdir)

  const targets: Target[] = [
    { id: 'baseline', label: `baseline (@nuxt/cli@${baselineSpec})`, dir: join(workdir, 'baseline'), bin: '', version: '', spec: baselineSpec },
    { id: 'head', label: 'head (local main)', dir: join(workdir, 'head'), bin: '', version: '', spec: `file:${tarball}` },
  ]

  for (const target of targets) {
    mkdirSync(target.dir, { recursive: true })
    writeFileSync(join(target.dir, 'package.json'), `${JSON.stringify({
      name: `nuxt-cli-bench-${target.id}`,
      private: true,
      dependencies: { '@nuxt/cli': target.spec },
    }, null, 2)}\n`)
    npm(['install', '--no-audit', '--no-fund'], target.dir)
    target.bin = join(target.dir, 'node_modules/@nuxt/cli/bin/nuxi.mjs')
    target.version = JSON.parse(readFileSync(join(target.dir, 'node_modules/@nuxt/cli/package.json'), 'utf8')).version
  }

  return targets
}

function packHead(workdir: string): string {
  const packageDir = join(repoRoot, 'packages/nuxt-cli')
  execFileSync('pnpm', ['build'], { cwd: packageDir, stdio: 'ignore' })
  const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', workdir], { cwd: packageDir, encoding: 'utf8' })
  const [entry] = JSON.parse(output) as { filename: string }[]
  return join(workdir, entry!.filename)
}

export function npm(args: string[], cwd: string): string {
  return execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function prepareFixtures(workdir: string): Fixture[] {
  const fixtures: Fixture[] = [
    { id: 'playground', label: 'repo `playground/` (2 pages, 1 layer, websocket nitro)', dir: join(workdir, 'fixture-playground') },
    { id: 'large', label: 'generated app (60 pages, 40 components, 10 server routes)', dir: join(workdir, 'fixture-large') },
  ]

  if (!existsSync(fixtures[0]!.dir)) {
    cpSync(join(repoRoot, 'playground'), fixtures[0]!.dir, {
      recursive: true,
      filter: src => !/node_modules|\.nuxt|\.data|\.output/.test(src),
    })
  }
  if (!existsSync(fixtures[1]!.dir)) {
    generateLargeFixture(fixtures[1]!.dir)
  }

  for (const fixture of fixtures) {
    mkdirSync(join(fixture.dir, 'server/routes'), { recursive: true })
    writeFileSync(join(fixture.dir, 'server/routes/__bench.ts'), `export default defineEventHandler(() => String(useRuntimeConfig().public.benchMarker ?? ''))\n`)
    writeFileSync(join(fixture.dir, 'package.json'), `${JSON.stringify({
      name: `nuxt-cli-bench-fixture-${fixture.id}`,
      private: true,
      type: 'module',
      dependencies: { 'nuxt': nuxtVersion(), 'vue-router': '^5.2.0' },
    }, null, 2)}\n`)
    if (installedNuxtSpec(fixture.dir) !== nuxtVersion()) {
      rmSync(join(fixture.dir, 'node_modules'), { recursive: true, force: true })
      rmSync(join(fixture.dir, 'package-lock.json'), { force: true })
      npm(['install', '--no-audit', '--no-fund'], fixture.dir)
    }
  }

  return fixtures
}

function installedNuxtSpec(fixtureDir: string): string | undefined {
  try {
    const lock = JSON.parse(readFileSync(join(fixtureDir, 'package-lock.json'), 'utf8'))
    if (!existsSync(join(fixtureDir, 'node_modules/nuxt'))) {
      return undefined
    }
    return lock.packages?.['']?.dependencies?.nuxt
  }
  catch {
    return undefined
  }
}

function nuxtVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'playground/package.json'), 'utf8'))
  return pkg.dependencies.nuxt
}

function generateLargeFixture(dir: string): void {
  mkdirSync(join(dir, 'app/pages'), { recursive: true })
  mkdirSync(join(dir, 'app/components'), { recursive: true })
  mkdirSync(join(dir, 'server/api'), { recursive: true })

  writeFileSync(join(dir, 'nuxt.config.ts'), `export default defineNuxtConfig({\n  compatibilityDate: '2024-09-05',\n})\n`)
  writeFileSync(join(dir, 'app/app.vue'), `<template>\n  <NuxtPage />\n</template>\n`)

  for (let i = 0; i < 40; i++) {
    writeFileSync(join(dir, `app/components/Widget${i}.vue`), [
      `<script setup lang="ts">`,
      `const count = ref(${i})`,
      `const doubled = computed(() => count.value * 2)`,
      `</script>`,
      ``,
      `<template>`,
      `  <div class="widget-${i}">`,
      `    <button @click="count++">widget ${i}: {{ count }} / {{ doubled }}</button>`,
      `  </div>`,
      `</template>`,
      ``,
    ].join('\n'))
  }

  for (let i = 0; i < 60; i++) {
    const widgets = Array.from({ length: 6 }, (_, w) => `    <Widget${(i * 6 + w) % 40} />`).join('\n')
    writeFileSync(join(dir, `app/pages/page-${i}.vue`), [
      `<script setup lang="ts">`,
      `const { data } = await useFetch('/api/item-${i % 10}')`,
      `</script>`,
      ``,
      `<template>`,
      `  <div>`,
      `    <h1>page ${i}: {{ data }}</h1>`,
      widgets,
      `  </div>`,
      `</template>`,
      ``,
    ].join('\n'))
  }
  writeFileSync(join(dir, 'app/pages/index.vue'), `<template>\n  <div>large fixture index</div>\n</template>\n`)

  for (let i = 0; i < 10; i++) {
    writeFileSync(join(dir, `server/api/item-${i}.ts`), `export default defineEventHandler(() => ({ item: ${i} }))\n`)
  }
}

export function clearBuildCache(fixtureDir: string): void {
  for (const entry of ['.nuxt', '.data', '.output', '.nitro', 'node_modules/.cache', 'node_modules/.vite']) {
    rmSync(join(fixtureDir, entry), { recursive: true, force: true })
  }
}

export function directorySize(dir: string): { bytes: number, files: number } {
  let bytes = 0
  let files = 0
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        continue
      }
      if (entry.isDirectory()) {
        walk(path)
      }
      else if (entry.isFile()) {
        bytes += statSync(path).size
        files++
      }
    }
  }
  walk(dir)
  return { bytes, files }
}
