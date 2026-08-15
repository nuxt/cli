import { cp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCI } from 'std-env'

export async function fetchWithPolling(url: string, options: RequestInit = {}, maxAttempts = 10, interval = 100): Promise<Response | null> {
  let response: Response | null = null
  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      response = await fetch(url, options)
      if (response.ok) {
        return response
      }
    }
    catch {
      // Ignore errors and retry
    }
    attempts++
    await new Promise(resolve => setTimeout(resolve, isCI ? interval * 10 : interval))
  }
  return response
}

/**
 * Clone the shared `dev` fixture into a project private to a single spec file.
 *
 * The dev e2e specs each wipe `.nuxt` and take the dev lock inside their
 * fixture, so pointing more than one of them at `fixtures/dev` makes them race
 * whenever vitest runs the files in parallel.
 *
 * Installed packages are linked in one by one rather than by symlinking
 * `node_modules` wholesale, so that the caches tooling writes underneath it
 * (`node_modules/.cache/vite`) belong to a single spec.
 */
export async function createDevFixture(name: string): Promise<string> {
  const source = fileURLToPath(new URL('../fixtures/dev', import.meta.url))
  const target = fileURLToPath(new URL(`../fixtures/.tmp-${name}`, import.meta.url))

  await rm(target, { recursive: true, force: true })
  await cp(source, target, {
    recursive: true,
    filter: entry => !entry.includes('node_modules') && !entry.includes(`${sep}.nuxt`),
  })
  const sourceModules = join(source, 'node_modules')
  const targetModules = join(target, 'node_modules')
  await mkdir(targetModules, { recursive: true })
  for (const entry of await readdir(sourceModules)) {
    if (entry === '.cache' || entry === '.vite') {
      continue
    }
    await symlink(join(sourceModules, entry), join(targetModules, entry), 'junction')
  }

  return target
}
