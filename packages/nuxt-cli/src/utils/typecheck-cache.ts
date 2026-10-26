import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { parseJSONC } from 'confbox/jsonc'
import { dirname, resolve } from 'pathe'

import { debug } from './logger'

interface ProjectConfig {
  compilerOptions?: { tsBuildInfoFile?: unknown }
  references?: Array<{ path: string }>
}

const STAMP_FILE = 'checker.stamp'

/**
 * Builds a cache key such as `vue-tsc@3.3.10+typescript@6.0.3` from the resolved entry files of the
 * packages that affect type-checking output. Returns `undefined` if any version cannot be read.
 */
export function resolveCacheKey(entries: Array<string | undefined>): string | undefined {
  const ids: string[] = []
  for (const entry of entries) {
    const id = entry && readPackageId(entry)
    if (!id) {
      return undefined
    }
    ids.push(id)
  }
  return ids.join('+')
}

/**
 * Returns `['--incremental']` if every project referenced by the solution-style `tsconfig.json` in
 * `cwd` sets its own `tsBuildInfoFile`, after discarding build info written for a different cache key
 * and marking the referenced configs as newer than their build info.
 */
export async function resolveIncrementalArgs(cwd: string, key: string): Promise<string[]> {
  try {
    const { configs, buildInfoFiles } = await resolveProjects(cwd)
    if (configs.length === 0 || buildInfoFiles.length < configs.length) {
      return []
    }

    await discardStaleBuildInfo(buildInfoFiles, key)

    // Build mode skips a project whose config and root files are older than its build info, without
    // checking the files they import.
    const now = new Date()
    await Promise.all(configs.map(config => utimes(config, now, now)))

    return ['--incremental']
  }
  catch (error) {
    debug('Skipping incremental type-checking:', error)
    return []
  }
}

/** Removes the build info of the projects referenced by the solution-style `tsconfig.json` in `cwd`. */
export async function discardBuildInfo(cwd: string): Promise<void> {
  try {
    const { buildInfoFiles } = await resolveProjects(cwd)
    await Promise.all(buildInfoFiles.map(file => rm(file, { force: true })))
  }
  catch (error) {
    debug('Could not remove build info:', error)
  }
}

async function resolveProjects(cwd: string) {
  const rootConfig = resolve(cwd, 'tsconfig.json')
  const configs = (await readConfig(rootConfig)).references?.map(reference => resolveReference(dirname(rootConfig), reference.path)) ?? []

  const buildInfoFiles: string[] = []
  for (const config of configs) {
    const tsBuildInfoFile = (await readConfig(config)).compilerOptions?.tsBuildInfoFile
    if (typeof tsBuildInfoFile === 'string') {
      buildInfoFiles.push(resolve(dirname(config), tsBuildInfoFile))
    }
  }
  return { configs, buildInfoFiles }
}

async function discardStaleBuildInfo(buildInfoFiles: string[], key: string) {
  const dirs = new Set(buildInfoFiles.map(file => dirname(file)))
  for (const dir of dirs) {
    const stamp = resolve(dir, STAMP_FILE)
    if (await readFile(stamp, 'utf8').catch(() => undefined) === key) {
      continue
    }
    await Promise.all(buildInfoFiles
      .filter(file => dirname(file) === dir)
      .map(file => rm(file, { force: true })))
    await mkdir(dir, { recursive: true })
    await writeFile(stamp, key)
  }
}

function resolveReference(dir: string, path: string) {
  const resolved = resolve(dir, path)
  return resolved.endsWith('.json') ? resolved : resolve(resolved, 'tsconfig.json')
}

async function readConfig(path: string): Promise<ProjectConfig> {
  return parseJSONC(await readFile(path, 'utf8'), { allowTrailingComma: true }) ?? {}
}

function readPackageId(entry: string): string | undefined {
  let dir = dirname(entry)
  while (true) {
    const manifest = resolve(dir, 'package.json')
    if (existsSync(manifest)) {
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string, version?: string }
      if (name && version) {
        return `${name}@${version}`
      }
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}
