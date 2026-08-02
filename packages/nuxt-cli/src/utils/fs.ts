import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'pathe'

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
  return clearDir(path, ['cache', 'analyze', 'nuxt.json', 'nuxt.lock'])
}
