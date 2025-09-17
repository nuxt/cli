import type { CommandDef } from 'citty'

const _rDefault = (r: any) => (r.default || r) as Promise<CommandDef>

export const commands = {
  add: () => import('./add').then(_rDefault),
  analyze: () => import('./analyze').then(_rDefault),
  build: () => import('./build').then(_rDefault),
  cleanup: () => import('./cleanup').then(_rDefault),
  _dev: () => import('./dev-child').then(_rDefault),
  dev: () => import('./dev').then(_rDefault),
  devtools: () => import('./devtools').then(_rDefault),
  generate: () => import('./generate').then(_rDefault),
  info: () => import('./info').then(_rDefault),
  init: () => import('./init').then(_rDefault),
  module: () => import('./module').then(_rDefault),
  prepare: () => import('./prepare').then(_rDefault),
  preview: () => import('./preview').then(_rDefault),
  start: () => import('./preview').then(_rDefault),
  test: () => import('./test').then(_rDefault),
  typecheck: () => import('./typecheck').then(_rDefault),
  upgrade: () => import('./upgrade').then(_rDefault),
} as const


// Inlined to avoid importing commands as it has sideeffects
export const nuxiCommands = [
  'add',
  'analyze',
  'build',
  'cleanup',
  '_dev',
  'dev',
  'devtools',
  'generate',
  'info',
  'init',
  'module',
  'prepare',
  'preview',
  'start',
  'test',
  'typecheck',
  'upgrade',
] as const satisfies (keyof typeof commands)[]

export function isNuxiCommand(command: string) {
  return (nuxiCommands as string[]).includes(command)
}