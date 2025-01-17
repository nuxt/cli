import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'pathe'

import { logger } from '../utils/logger'

// Check if a file exists
async function exists(path: string) {
  try {
    await fsp.access(path)
    return true
  }
  catch {
    return false
  }
}

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
  return clearDir(path, ['cache', 'analyze', 'nuxt.json'])
}

export async function rmRecursive(paths: string[]) {
  await Promise.all(
    paths
      .filter(p => typeof p === 'string')
      .map(async (path) => {
        logger.debug('Removing recursive path', path)
        await fsp.rm(path, { recursive: true, force: true }).catch(() => {})
      }),
  )
}

export async function touchFile(path: string) {
  if (await exists(path)) {
    return
  }
  await fsp.writeFile(path, '').catch(() => {
    logger.error(`Failed to create file: ${path}`)
  })
}
