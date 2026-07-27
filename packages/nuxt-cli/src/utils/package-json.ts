import type { PackageJson } from 'pkg-types'

import { resolveModulePath } from 'exsolve'
import { join } from 'pathe'
import { readPackageJSON } from 'pkg-types'

/**
 * Read the `package.json` of an installed dependency.
 *
 * `readPackageJSON(name, { try: true })` falls back to the nearest `package.json`
 * above the current working directory when the package cannot be resolved, which
 * silently returns the consuming project's own manifest in place of the one that
 * was asked for. Resolution happens here instead so a dependency that is not
 * installed reports as missing.
 *
 * The manifest is asked for directly first, then located from the package's entry
 * point, because `exports` may withhold either one of the two.
 */
export async function readDependencyPackageJson(name: string, from: string): Promise<PackageJson | undefined> {
  const options = { from: join(from, '/'), try: true }
  const path = resolveModulePath(`${name}/package.json`, options) ?? resolveModulePath(name, options)

  return path ? await readPackageJSON(path).catch(() => undefined) : undefined
}
