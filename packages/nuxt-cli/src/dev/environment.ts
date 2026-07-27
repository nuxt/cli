import { existsSync, readFileSync } from 'node:fs'
import { release } from 'node:os'
import process from 'node:process'

let dockerCache: boolean | undefined
let wslKernelCache: boolean | undefined

/** Whether this process is running inside a Docker (or compatible) container. */
export function isDocker(): boolean {
  dockerCache ??= existsSync('/.dockerenv') || readTextFile('/proc/self/cgroup').includes('docker')
  return dockerCache
}

/**
 * Whether this process is running under the Windows Subsystem for Linux.
 *
 * WSL1 spells the kernel release `Microsoft`, WSL2 `microsoft-standard-WSL2`.
 * A custom-kernel WSL2 install has neither, so `/proc/version` is checked too.
 */
export function isWsl(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform !== 'linux') {
    return false
  }
  if (env.WSL_DISTRO_NAME) {
    return true
  }
  wslKernelCache ??= release().toLowerCase().includes('microsoft')
    || readTextFile('/proc/version').toLowerCase().includes('microsoft')
  return wslKernelCache
}

/**
 * The name of the container-like environment a loopback bind is unreachable
 * from, or `undefined` when the dev server is running directly on the host.
 */
export function detectIsolatedEnvironment(): string | undefined {
  if (isDocker()) {
    return 'the container'
  }
  if (isWsl()) {
    return 'WSL'
  }
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  }
  catch {
    return ''
  }
}
