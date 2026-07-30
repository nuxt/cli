/**
 * A pipe closing early is a property of the other end of the pipe, not a fault
 * in the dev server: a clipboard tool that exited before we wrote to it, or
 * `nuxt dev | head` closing stdout. Such errors should never be reported as
 * crashes or trigger a restart.
 */
export function isBrokenPipe(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED'
}

/**
 * A client hanging up mid-request is normal traffic for a dev server: a browser
 * reloading while a page is still streaming, a proxied websocket dropped when a
 * worker is replaced, or a tab closed mid-navigation. Like a broken pipe, this
 * says something about the other end of the connection rather than about this
 * process, so it must not be treated as a crash or trigger a restart.
 */
export function isAbortedConnection(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'ERR_STREAM_PREMATURE_CLOSE'
}
