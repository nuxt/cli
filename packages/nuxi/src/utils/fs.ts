import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'pathe'
import { debug } from '../utils/logger'

export async function clearDir(path: string, exclude?: string[]) {
  if (!exclude) {
    await fsp.rm(path, { recursive: true, force: true })
  }
  else if (existsSync(path)) {
    const files = await fsp.readdir(path)
    await Promise.all(
      files.map(async (name) => {
        if (!exclude.includes(name)) {
          await fsp.rm(join(path, name), { recursive: true, force: true })
        }
      }),
    )
  }
  await fsp.mkdir(path, { recursive: true })
}

export function clearBuildDir(path: string) {
  // Keep `locks/` so a wipe never deletes a presence marker a peer dev/build
  // process just wrote (see utils/lockfile). `nuxt.lock` is the pre-`locks/`
  // marker name, retained so an in-flight upgrade doesn't strand an old server.
  return clearDir(path, ['cache', 'analyze', 'nuxt.json', 'nuxt.lock', 'locks'])
}

export async function rmRecursive(paths: string[]) {
  await Promise.all(
    paths
      .filter(p => typeof p === 'string')
      .map(async (path) => {
        debug(`Removing recursive path: ${path}`)
        await fsp.rm(path, { recursive: true, force: true }).catch(() => {})
      }),
  )
}
