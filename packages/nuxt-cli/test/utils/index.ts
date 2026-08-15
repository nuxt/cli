import { cp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCI } from 'std-env'

/**
 * Poll `url` until it answers, allowing for a server that is still booting.
 *
 * The deadline is a wall-clock budget rather than an attempt count, so a slow
 * machine gets the same number of seconds as a fast one.
 */
export async function fetchWithPolling(url: string, options: RequestInit = {}, timeout = isCI ? 120_000 : 30_000, interval = 100): Promise<Response | null> {
  const deadline = Date.now() + timeout
  let response: Response | null = null
  do {
    try {
      response = await fetch(url, options)
      if (response.ok) {
        return response
      }
    }
    catch {
      // Ignore errors and retry
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  } while (Date.now() < deadline)
  return response
}

/**
 * Copy a fixture into a project private to a single spec file.
 *
 * The e2e specs build, clear and take locks inside their fixture, so pointing
 * more than one of them at the same directory makes them race whenever vitest
 * runs the files in parallel.
 *
 * Installed packages are linked in one by one rather than by symlinking
 * `node_modules` wholesale, so that the caches tooling writes underneath it
 * (`node_modules/.cache/vite`) belong to a single spec.
 */
async function createFixture(source: string, name: string): Promise<string> {
  const target = fileURLToPath(new URL(`../fixtures/.tmp-${name}`, import.meta.url))

  await rm(target, { recursive: true, force: true })
  await cp(source, target, {
    recursive: true,
    filter: entry => !entry.includes('node_modules') && !entry.includes(`${sep}.nuxt`) && !entry.includes(`${sep}.output`),
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

/** Copy of the shared `dev` fixture, private to a single spec file. */
export function createDevFixture(name: string): Promise<string> {
  return createFixture(fileURLToPath(new URL('../fixtures/dev', import.meta.url)), name)
}

/** Copy of the workspace playground, private to a single spec file. */
export function createPlaygroundFixture(name: string): Promise<string> {
  return createFixture(fileURLToPath(new URL('../../../../playground', import.meta.url)), name)
}
