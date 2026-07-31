import process from 'node:process'
import { styleText } from 'node:util'
import { debug, logger } from '../utils/logger'

export interface InspectOptions {
  host: string
  port: number
  /** Wait for a debugger to attach before running any user code (`--inspect-brk`). */
  wait: boolean
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9229

const INSPECT_ARG_RE = /^--inspect(-brk|-wait|-port)?(?:=(.*))?$/

/**
 * Resolve Node inspector options from CLI/exec arguments, following Node's own
 * `--inspect[=[host:]port]` parsing rules.
 *
 * Returns `undefined` when the inspector was not requested. `--inspect-port` on
 * its own does not enable the inspector, it only sets the address to use.
 */
export function parseInspectArgs(args: string[]): InspectOptions | undefined {
  let enabled = false
  let wait = false
  let host = DEFAULT_HOST
  let port = DEFAULT_PORT

  for (const arg of args) {
    const match = INSPECT_ARG_RE.exec(arg)
    if (!match) {
      continue
    }
    const [, modifier, value] = match

    if (modifier !== '-port') {
      enabled = true
      wait ||= modifier === '-brk' || modifier === '-wait'
    }

    const target = parseTarget(value)
    if (target.host !== undefined) {
      host = target.host
    }
    if (target.port !== undefined) {
      port = target.port
    }
  }

  return enabled ? { host, port, wait } : undefined
}

function parseTarget(value: string | undefined): { host?: string, port?: number } {
  if (!value) {
    return {}
  }

  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end === -1) {
      return {}
    }
    const host = value.slice(1, end)
    const rest = value.slice(end + 1)
    return rest.startsWith(':') ? { host, port: toPort(rest.slice(1)) } : { host }
  }

  const separator = value.lastIndexOf(':')
  if (separator !== -1) {
    return { host: value.slice(0, separator) || DEFAULT_HOST, port: toPort(value.slice(separator + 1)) }
  }

  if (/^\d+$/.test(value)) {
    return { port: toPort(value) }
  }
  return { host: value }
}

function toPort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined
  }
  const port = Number(value)
  return port >= 0 && port <= 65535 ? port : undefined
}

/**
 * Open the inspector in the current process, or move it to the requested
 * address if Node already opened one via `execArgv`.
 */
export async function openInspector(options: InspectOptions): Promise<void> {
  const inspector = await import('node:inspector')

  try {
    if (inspector.url()) {
      inspector.close()
    }
    // Node itself logs `Debugger listening on …` when the inspector opens.
    inspector.open(options.port, options.host, options.wait)
  }
  catch (error) {
    logger.warn(`Could not start the inspector on ${styleText('cyan', `${options.host}:${options.port}`)}: ${error instanceof Error ? error.message : error}`)
  }
}

/** Release the inspector port so another process (a fork) can bind to it. */
export async function closeInspector(): Promise<void> {
  try {
    const inspector = await import('node:inspector')
    if (inspector.url()) {
      inspector.close()
    }
  }
  catch (error) {
    debug(`Could not close the inspector: ${error}`)
  }
}

/** Node exec arguments are inspected too, so `node --inspect nuxt dev` behaves like `nuxt dev --inspect`. */
export function resolveInspectOptions(rawArgs: string[]): InspectOptions | undefined {
  return parseInspectArgs([...process.execArgv, ...rawArgs])
}
