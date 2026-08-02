import { execFileSync } from 'node:child_process'
import process from 'node:process'

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
