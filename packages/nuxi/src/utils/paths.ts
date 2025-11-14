import process from 'node:process'
import { relative } from 'pathe'

const cwd = process.cwd()

export function relativeToProcess(path: string) {
  return relative(cwd, path) || path
}
