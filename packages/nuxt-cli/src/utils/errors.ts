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
