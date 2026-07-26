import { delimiter, relative } from 'node:path'
import process from 'node:process'
import { link } from 'clickable-path'

const cwd = process.cwd()

export function relativeToProcess(path: string) {
  return link(path, {
    cwd,
    formatter: absolute => relative(cwd, absolute) || absolute,
  })
}

export function withNodePath(path: string) {
  return [path, ...(process.env.NODE_PATH?.split(delimiter) || [])]
}
