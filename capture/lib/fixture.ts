import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Mirror a fixture into a work directory, returning the changed paths.
 *
 * Only files whose content actually changed are rewritten: a blanket copy
 * touches every config file's mtime and invalidates Vite's dependency cache,
 * putting a "Re-optimizing dependencies" line into the next run. Files deleted
 * from the fixture are removed so stale routes or handlers cannot leak in.
 *
 * `preserve` names the top-level entries the fixture does not own, such as
 * installed dependencies and build caches.
 */
export function syncFixture(from: string, to: string, preserve: Set<string>): string[] {
  const changed: string[] = []
  mkdirSync(to, { recursive: true })
  const sourceEntries = readdirSync(from, { recursive: true, encoding: 'utf8' })
  const sourceFiles = new Set(sourceEntries)
  for (const entry of sourceEntries) {
    const source = join(from, entry)
    if (statSync(source).isDirectory()) {
      continue
    }
    const target = join(to, entry)
    const content = readFileSync(source)
    let unchanged = false
    try {
      unchanged = readFileSync(target).equals(content)
    }
    catch {}
    if (!unchanged) {
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content)
      changed.push(entry)
    }
  }
  for (const entry of readdirSync(to, { recursive: true, encoding: 'utf8' })) {
    if (preserve.has(entry.split('/')[0]!)) {
      continue
    }
    const target = join(to, entry)
    if (!sourceFiles.has(entry) && !statSync(target).isDirectory()) {
      rmSync(target)
      changed.push(entry)
    }
  }
  return changed
}
