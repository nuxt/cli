import type { Session } from 'node:inspector'
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
 * Open the inspector for the nitro dev server worker on the requested address,
 * and the inspector for this process on the next port. Node's own inspector
 * from `execArgv` is moved there too.
 */
export async function openInspector(inspectOptions: InspectOptions): Promise<void> {
  const inspector = await import('node:inspector')
  const options = resolveProcessInspectOptions(inspectOptions)

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

  inspectDevWorkers(inspector.Session, { ...inspectOptions, wait: false })
}

let workerSession: Session | undefined

/**
 * Inspector address for the CLI process itself, which loads `nuxt.config` and
 * modules. Server code runs in a nitro worker thread on the requested port.
 */
export function resolveProcessInspectOptions(options: InspectOptions): InspectOptions {
  return { ...options, port: options.port === 0 ? 0 : options.port + 1 }
}

/**
 * Runs inside a worker thread, so it must be self-contained. Waits for the
 * port to be released by the worker it replaces before opening the inspector.
 */
function openWorkerInspector(host: string, port: number): void {
  // eslint-disable-next-line node/prefer-global/process
  const proc = (globalThis as any).process
  const { workerData } = proc.getBuiltinModule('node:worker_threads')
  if (!proc.env.NITRO_DEV_WORKER_ID && typeof workerData?.name !== 'string') {
    return
  }
  const inspector = proc.getBuiltinModule('node:inspector')
  const { createServer } = proc.getBuiltinModule('node:net')
  const deadline = Date.now() + 10_000
  const retry = (): void => {
    if (Date.now() < deadline) {
      setTimeout(attempt, 100).unref()
    }
  }
  const open = (): void => {
    inspector.open(port, host, false)
    if (!inspector.url()) {
      retry()
    }
  }
  function attempt(): void {
    if (port === 0) {
      return open()
    }
    const probe = createServer()
    probe.unref()
    probe.once('error', retry)
    probe.listen(port, host, () => probe.close(open))
  }
  attempt()
}

/** Open an inspector inside each nitro dev worker thread this process starts. */
export function inspectDevWorkers(SessionConstructor: typeof Session, options: InspectOptions): void {
  try {
    workerSession?.disconnect()
    const session = new SessionConstructor()
    session.connect()
    const expression = `(${openWorkerInspector.toString()})(${JSON.stringify(options.host)}, ${options.port})`
    session.on('NodeWorker.attachedToWorker', ({ params }) => {
      const { sessionId } = params
      const message = JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } })
      session.post('NodeWorker.sendMessageToWorker', { sessionId, message }, (error) => {
        if (error) {
          debug(`Could not open the inspector in a worker: ${error.message}`)
        }
      })
    })
    session.on('NodeWorker.receivedMessageFromWorker', ({ params }) => {
      session.post('NodeWorker.detach', { sessionId: params.sessionId }, () => {})
    })
    session.post('NodeWorker.enable', { waitForDebuggerOnStart: false }, () => {})
    workerSession = session
  }
  catch (error) {
    debug(`Could not watch worker threads for the inspector: ${error}`)
  }
}

/** Release the inspector port so another process (a fork) can bind to it. */
export async function closeInspector(): Promise<void> {
  try {
    workerSession?.disconnect()
    workerSession = undefined
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
