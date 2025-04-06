import { execSync } from 'node:child_process'

export function getPackageManagerVersion(name: string) {
  return execSync(`${name} --version`).toString('utf8').trim()
}
