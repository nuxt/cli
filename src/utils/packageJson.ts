import type { PackageJson } from 'pkg-types'
import { tryRequireModule } from './cjs'
import { writeFileSync } from 'node:fs'
import { join } from 'pathe'

export async function readPackageJson(dir: string): Promise<PackageJson> {
  return await tryRequireModule('./package.json', dir)
}

export function writePackageJson(dir: string, content: unknown) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2))
}
