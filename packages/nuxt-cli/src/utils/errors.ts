const REMOTE_PEER_ERROR_CODES = new Set([
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'ECONNRESET',
  'ECONNABORTED',
  'ERR_STREAM_PREMATURE_CLOSE',
])

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
