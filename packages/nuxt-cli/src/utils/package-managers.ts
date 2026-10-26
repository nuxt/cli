import type { AgentName, DetectResult } from 'package-manager-detector'
import { execFile } from 'node:child_process'

import { LOCKS } from 'package-manager-detector/constants'
import { detect } from 'package-manager-detector/detect'
import { normalizeSpawnCommand } from 'tinyexec'

const preferredOrder: AgentName[] = ['npm', 'pnpm', 'yarn', 'bun', 'deno']

function rank(name: AgentName) {
  const index = preferredOrder.indexOf(name)
  return index === -1 ? preferredOrder.length : index
}

/** Supported package managers, in the order they are offered to the user. */
export const packageManagerNames: AgentName[] = [...new Set(Object.values(LOCKS))].sort((a, b) => rank(a) - rank(b))

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

export function getPackageManagerVersion(command: string): Promise<string> {
  const normalized = normalizeSpawnCommand(command, ['--version'])
  return new Promise((resolve) => {
    const child = execFile(normalized.command, [...normalized.args], normalized.options, (error, stdout) => {
      resolve(error ? 'unknown' : stdout.trim())
    })
    child.stdin?.end()
  })
}
