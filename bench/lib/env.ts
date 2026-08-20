import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import process from 'node:process'

export interface Environment {
  node: string
  os: string
  kernel: string
  cpu: string
  cores: number
  memory: string
  date: string
  loadAverage: string
}

export function environment(): Environment {
  const cpus = os.cpus()
  return {
    node: process.version,
    os: `${os.type()} ${os.release().split('-')[0]}`,
    kernel: os.release(),
    cpu: cpus[0]?.model || cpuFromProc() || 'unknown',
    cores: cpus.length,
    memory: `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`,
    date: new Date().toISOString(),
    loadAverage: os.loadavg().map(n => n.toFixed(2)).join(', '),
  }
}

function cpuFromProc(): string | undefined {
  try {
    const info = readFileSync('/proc/cpuinfo', 'utf8')
    const line = info.split('\n').find(l => /^(?:model name|Model|Hardware)\s*:/.test(l))
    return line?.split(':')[1]?.trim()
  }
  catch {
    return undefined
  }
}

export function gitDescribe(cwd: string): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8' }).trim()
  }
  catch {
    return 'unknown'
  }
}
