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
 * Set on a diagnostic once Nuxt's reporter has printed it, so the CLI does not
 * print it a second time when the same error reaches a command's handler.
 */
const NUXT_DIAGNOSTIC_REPORTED: unique symbol = Symbol.for('nuxt.diagnostic.reported')

type NuxtDiagnostic = Error & {
  name?: unknown
  code?: unknown
  pluginCode?: unknown
  fix?: unknown
  docs?: unknown
}

/**
 * Re-raise a Nuxt error by the remedy it carries rather than by its stack.
 *
 * Nuxt tags the errors it raises with `fix`, the command that resolves it, and
 * `docs`, where the rest is explained. Those frames are all inside
 * `node_modules` or this CLI's own `dist`, so the remedy is the whole of what a
 * reader can act on. An error Nuxt has already printed is dropped, and an
 * untagged error is returned as it came.
 */
export function asActionableError(error: unknown): unknown {
  if (isReportedError(error)) {
    return undefined
  }
  if (!(error instanceof Error)) {
    return error
  }
  const diagnostic = error as NuxtDiagnostic
  const code = getNuxtDiagnosticCode(diagnostic)
  const fix = typeof diagnostic.fix === 'string' && diagnostic.fix.trim()
    ? diagnostic.fix
    : undefined
  const docs = typeof diagnostic.docs === 'string' && diagnostic.docs.trim()
    ? diagnostic.docs
    : undefined
  if (!code && !fix && !docs) {
    return error
  }
  const lines = [
    code
      ? `[${code}] ${error.message}`
      : error.message,
  ]
  if (fix) {
    lines.push(fix)
  }
  if (docs) {
    lines.push(`See ${docs}`)
  }
  return new ActionableError(lines.join('\n'))
}

function getNuxtDiagnosticCode(diagnostic: NuxtDiagnostic): string | undefined {
  return [diagnostic.name, diagnostic.code, diagnostic.pluginCode]
    .find((value): value is string => typeof value === 'string' && value.startsWith('NUXT_'))
}

/**
 * Whether Nuxt has already printed the diagnostic, or, for a bundler that
 * rewrapped it, whether every one of the wrapped diagnostics has.
 */
export function isReportedError(error: unknown): boolean {
  if (isReportedDiagnostic(error)) {
    return true
  }
  const errors = (error as { errors?: unknown } | undefined)?.errors
  return Array.isArray(errors) && errors.length > 0 && errors.every(isReportedDiagnostic)
}

function isReportedDiagnostic(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as Record<PropertyKey, unknown>)[NUXT_DIAGNOSTIC_REPORTED] === true
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
