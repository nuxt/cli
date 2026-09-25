const REMOTE_PEER_ERROR_CODES = new Set([
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'ECONNRESET',
  'ECONNABORTED',
  'ERR_STREAM_PREMATURE_CLOSE',
])

/**
 * An error whose message already contains everything the user needs: what went
 * wrong and the command to run. The stack is replaced with the message so the
 * terminal shows the advice rather than frames inside `dist`.
 */
export class ActionableError extends Error {
  override name = 'ActionableError'

  constructor(message: string) {
    super(message)
    this.stack = message
  }
}

/**
 * Re-raise a Nuxt error by the remedy it carries rather than by its stack.
 *
 * Nuxt tags the errors it raises with `fix`, the command that resolves it, and
 * `docs`, where the rest is explained. Those frames are all inside
 * `node_modules` or this CLI's own `dist`, so the remedy is the whole of what a
 * reader can act on. An untagged error is returned as it came.
 */
export function asActionableError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error
  }
  const { fix, docs } = error as Error & { fix?: unknown, docs?: unknown }
  if (typeof fix !== 'string' || !fix.trim()) {
    return error
  }
  const lines = [error.message, fix]
  if (typeof docs === 'string' && docs.trim()) {
    lines.push(`See ${docs}`)
  }
  return new ActionableError(lines.join('\n'))
}

/**
 * Errors that say something about the other end of a connection rather than
 * about this process: a broken pipe, a client hanging up mid-request, a tab
 * closed mid-navigation. These should not be reported as crashes or trigger
 * a restart.
 */
export function isRemotePeerError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return !!code && REMOTE_PEER_ERROR_CODES.has(code)
}

/**
 * Marks an `uncaughtException` listener that keeps the process alive (by
 * replacing the crashed server) rather than letting it exit. The interactive
 * dev UI leaves the terminal to such a listener instead of tearing down.
 */
export const KEEPS_PROCESS_ALIVE: unique symbol = Symbol.for('nuxt:keeps-process-alive')
