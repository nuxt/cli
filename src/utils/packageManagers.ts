import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'pathe'
import { findup } from './fs'

export const packageManagerLocks = {
  yarn: ['yarn.lock'],
  npm: ['package-lock.json'],
  pnpm: ['pnpm-lock.yaml'],
  bun: ['bun.lockb', 'bun.lock'],
}

export function getPackageManager(rootDir: string) {
  return findup(rootDir, (dir) => {
    let name: keyof typeof packageManagerLocks
    for (name in packageManagerLocks) {
      const paths = packageManagerLocks[name]
      for (const lockFilePath of paths) {
        if (lockFilePath && existsSync(resolve(dir, lockFilePath))) {
          return {
            name,
            lockFilePath,
          }
        }
      }
    }
  })
}

export function getPackageManagerVersion(name: string) {
  return execSync(`${name} --version`).toString('utf8').trim()
}
