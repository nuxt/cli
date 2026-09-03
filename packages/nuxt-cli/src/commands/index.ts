import type { CommandDef, SubCommandsDef } from 'citty'

import { asActionableError } from '../utils/errors'

type Resolvable<T> = T | Promise<T> | (() => T) | (() => Promise<T>)

function resolve<T>(value: Resolvable<T>): T | Promise<T> {
  return typeof value === 'function' ? (value as () => T | Promise<T>)() : value
}

/**
 * Carry the boundary into a command's subcommands, keeping each one lazy so
 * wrapping a parent never loads them.
 *
 * The map is itself resolvable, and enumerating a function or a promise yields
 * no entries, so it is resolved before being walked and stays a resolver where
 * it began as one.
 */
function withRemedies(subCommands: Resolvable<SubCommandsDef>): Resolvable<SubCommandsDef> {
  const wrapEntries = (resolved: SubCommandsDef): SubCommandsDef => Object.fromEntries(
    Object.entries(resolved).map(([name, subCommand]) => [
      name,
      async () => withRemedy(await resolve(subCommand)),
    ]),
  )
  return typeof subCommands === 'function' || subCommands instanceof Promise
    ? async () => wrapEntries(await resolve(subCommands))
    : wrapEntries(subCommands)
}

/**
 * One error boundary for every command.
 *
 * A tagged error can be raised from any of the kit entry points a command
 * touches, so the remedy is applied where the command ends rather than at each
 * of them.
 */
export function withRemedy(command: CommandDef): CommandDef {
  const { run, subCommands } = command
  return {
    ...command,
    ...run && {
      async run(context: Parameters<typeof run>[0]) {
        try {
          return await run(context)
        }
        catch (error) {
          throw asActionableError(error)
        }
      },
    },
    ...subCommands && { subCommands: withRemedies(subCommands) },
  }
}

const _rDefault = (r: any) => withRemedy((r.default || r) as CommandDef) as unknown as Promise<CommandDef>

const commandLoaders = {
  'add': () => import('./add').then(_rDefault),
  'add-template': () => import('./add-template').then(_rDefault),
  'analyze': () => import('./analyze').then(_rDefault),
  'build': () => import('./build').then(_rDefault),
  'cleanup': () => import('./cleanup').then(_rDefault),
  'curl': () => import('./curl').then(_rDefault),
  '_dev': () => import('./dev-child').then(_rDefault),
  'dev': () => import('./dev').then(_rDefault),
  'devtools': () => import('./devtools').then(_rDefault),
  'docs': () => import('./docs').then(_rDefault),
  'generate': () => import('./generate').then(_rDefault),
  'info': () => import('./info').then(_rDefault),
  'init': () => import('./init').then(_rDefault),
  'module': () => import('./module').then(_rDefault),
  'prepare': () => import('./prepare').then(_rDefault),
  'preview': () => import('./preview').then(_rDefault),
  'start': () => import('./start').then(_rDefault),
  'task': () => import('./task').then(_rDefault),
  'test': () => import('./test').then(_rDefault),
  'typecheck': () => import('./typecheck').then(_rDefault),
  'upgrade': () => import('./upgrade').then(_rDefault),
} as const

export const commands = Object.assign(Object.create(null), commandLoaders) as typeof commandLoaders
