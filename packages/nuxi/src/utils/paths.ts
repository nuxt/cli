import process from 'node:process'
import { relative } from 'pathe'

const cwd = process.cwd()

export function relativeToProcess(path: string) {
  return relative(cwd, path) || path
}

export function withNodePath(path: string) {
  return [path, process.env.NODE_PATH].filter((i): i is NonNullable<typeof i> => !!i)
}
