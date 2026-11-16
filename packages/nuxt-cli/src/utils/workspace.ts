import { existsSync } from 'node:fs'

import { dirname, join, resolve } from 'pathe'

/** Nearest `pnpm-workspace.yaml` at or above `cwd`. */
export function findPnpmWorkspaceYaml(cwd: string): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const filePath = join(dir, 'pnpm-workspace.yaml')
    if (existsSync(filePath)) {
      return filePath
    }
    if (dir === dirname(dir)) {
      return undefined
    }
  }
}
