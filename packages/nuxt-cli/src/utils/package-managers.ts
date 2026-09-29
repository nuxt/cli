import type { AgentName, DetectResult } from 'package-manager-detector'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

import { LOCKS } from 'package-manager-detector/constants'
import { detect } from 'package-manager-detector/detect'

/** Supported package managers, in the order they are offered to the user. */
export const packageManagerNames: AgentName[] = ['npm', 'pnpm', 'yarn', 'bun', 'deno', 'aube', 'nub']

/** Used when no package manager can be detected. */
export const defaultPackageManager: DetectResult = { name: 'npm', agent: 'npm' }

export function isPackageManagerName(name: unknown): name is AgentName {
  return packageManagerNames.includes(name as AgentName)
}

/** Lockfiles written by `name`, excluding workspace manifests. */
export function getLockFiles(name: AgentName): string[] {
  return Object.keys(LOCKS).filter(file => LOCKS[file] === name && !file.includes('workspace'))
}

/** Detect the nearest project's package manager, checking only `cwd` when `includeParentDirs` is `false`. */
export async function detectPackageManager(cwd: string, { includeParentDirs = true } = {}): Promise<DetectResult | undefined> {
  return await detect({ cwd, stopDir: includeParentDirs ? undefined : cwd }).catch(() => null) ?? undefined
}

export function getPackageManagerVersion(command: string) {
  // Package managers are `.cmd` shims on Windows, which cannot be spawned without a shell.
  const isWindows = process.platform === 'win32'
  try {
    return execFileSync(isWindows ? `"${command}"` : command, ['--version'], { shell: isWindows, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim()
  }
  catch {
    return 'unknown'
  }
}
