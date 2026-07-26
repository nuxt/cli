import type { PackageJson } from 'pkg-types'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { dirname, join, resolve } from 'pathe'
import { parsePnpmWorkspaceYaml } from 'pnpm-workspace-yaml'

const CATALOG_SPECIFIER_RE = /^catalog:(.*)$/

const DEFAULT_CATALOG = 'default'

export interface CatalogEntry {
  /** The catalog the specifier points at. `default` for a bare `catalog:`. */
  catalog: string
  /** The specifier the catalog resolves to, e.g. `^4.2.0`. Absent when the catalog has no such entry. */
  specifier?: string
}

export interface CatalogConfig {
  /** Absolute path of the `pnpm-workspace.yaml` the catalogs are declared in. */
  filePath: string
  catalogs: Record<string, Record<string, string>>
}

/**
 * The catalog a `catalog:` / `catalog:name` specifier refers to, or `undefined`
 * for any other specifier.
 */
export function parseCatalogSpecifier(specifier: string | undefined): string | undefined {
  const match = specifier?.match(CATALOG_SPECIFIER_RE)
  if (!match) {
    return undefined
  }
  return match[1] || DEFAULT_CATALOG
}

/** Nearest `pnpm-workspace.yaml` at or above `cwd`. */
export function findPnpmWorkspaceYaml(cwd: string): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const filePath = join(dir, 'pnpm-workspace.yaml')
    if (existsSync(filePath)) {
      return filePath
    }
    if (dir === dirname(dir)) {
      return undefined
    }
  }
}

const configCache = new Map<string, CatalogConfig | undefined>()

/** Discard memoised catalog configuration, so a later read sees changes on disk. */
export function clearCatalogCache(): void {
  configCache.clear()
}

/**
 * Catalogs declared in the nearest `pnpm-workspace.yaml`, keyed by catalog name.
 * The top-level `catalog` key is exposed as {@link DEFAULT_CATALOG}.
 *
 * Results are memoised per workspace file, as commands such as `nuxi info` query
 * dozens of dependencies in a row.
 */
export function readCatalogConfig(cwd: string): CatalogConfig | undefined {
  const filePath = findPnpmWorkspaceYaml(cwd)
  if (!filePath) {
    return undefined
  }

  if (configCache.has(filePath)) {
    return configCache.get(filePath)
  }

  const config = parseCatalogConfig(filePath)
  configCache.set(filePath, config)
  return config
}

function parseCatalogConfig(filePath: string): CatalogConfig | undefined {
  let workspace: ReturnType<typeof parsePnpmWorkspaceYaml>
  try {
    workspace = parsePnpmWorkspaceYaml(readFileSync(filePath, 'utf-8'))
  }
  catch {
    return undefined
  }

  const json = workspace.toJSON()
  const catalogs: CatalogConfig['catalogs'] = { ...json.catalogs }
  if (json.catalog) {
    catalogs[DEFAULT_CATALOG] = json.catalog
  }

  if (Object.keys(catalogs).length === 0) {
    return undefined
  }

  return { filePath, catalogs }
}

/**
 * Resolve the specifier `pkg` is declared with in `pkgJson` through the project's
 * catalogs. Returns `undefined` when the dependency is absent or not
 * catalog-managed, so a caller can fall back to the declared specifier.
 */
export function resolveCatalogEntry(cwd: string, pkgJson: PackageJson | null | undefined, pkg: string): CatalogEntry | undefined {
  const specifier = pkgJson?.dependencies?.[pkg] || pkgJson?.devDependencies?.[pkg]
  const catalog = parseCatalogSpecifier(specifier)
  if (!catalog) {
    return undefined
  }

  const config = readCatalogConfig(cwd)
  return { catalog, specifier: config?.catalogs[catalog]?.[pkg] }
}

/** The outcome of a {@link updateCatalogEntries} call. */
export type UpdateCatalogEntriesResult = 'updated' | 'unchanged' | 'failed'

export interface CatalogEntryUpdate {
  catalog: string
  pkg: string
  specifier: string
}

/**
 * Point catalog entries at new specifiers in a single read/write of
 * `pnpm-workspace.yaml`, preserving its comments, anchors and aliases.
 */
export function updateCatalogEntries(cwd: string, updates: CatalogEntryUpdate[]): UpdateCatalogEntriesResult {
  const filePath = findPnpmWorkspaceYaml(cwd)
  if (!filePath) {
    return 'failed'
  }

  try {
    const workspace = parsePnpmWorkspaceYaml(readFileSync(filePath, 'utf-8'))
    for (const { catalog, pkg, specifier } of updates) {
      workspace.setPackage(catalog, pkg, specifier)
    }
    if (!workspace.hasChanged()) {
      return 'unchanged'
    }

    writeFileSync(filePath, workspace.toString(), 'utf-8')
    configCache.delete(filePath)
    return 'updated'
  }
  catch {
    return 'failed'
  }
}
