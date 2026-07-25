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
