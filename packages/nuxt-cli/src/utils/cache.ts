import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'

/**
 * A directory under the user's cache home (`XDG_CACHE_HOME`, else `~/.cache`)
 * for Nuxt to keep downloaded artefacts in, created if it does not exist.
 */
export function getCacheDir(...segments: string[]): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  const dir = join(base, 'nuxt', ...segments)
  mkdirSync(dir, { recursive: true })
  return dir
}
