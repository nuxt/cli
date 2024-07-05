import { writeFileSync } from 'node:fs'
import type { PackageJson } from 'pkg-types'
import { join } from 'pathe'
import { tryRequireModule } from './cjs'

export async function readPackageJson(dir: string): Promise<PackageJson> {
  return await tryRequireModule('./package.json', dir)
}

export function writePackageJson(dir: string, content: unknown) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2))
}
