import { delimiter } from 'node:path'
import process from 'node:process'
import { resolveModulePath } from 'exsolve'

/** `path` first, then whatever `NODE_PATH` adds, as resolution roots. */
export function withNodePath(path: string): string[] {
  return [path, ...(process.env.NODE_PATH?.split(delimiter) || [])]
}

/** Where the project's `nuxt` lives, nightly first, or `null` if it has none. */
export function tryResolveNuxt(rootDir: string): string | null {
  for (const pkg of ['nuxt-nightly', 'nuxt']) {
    const path = resolveModulePath(pkg, { from: withNodePath(rootDir), try: true })
    if (path) {
      return path
    }
  }
  return null
}
