import { openBroadcast } from './broadcast'

/** A timed piece of work the app did while serving a request. */
export interface DevRequestSpan {
  requestId: string
  /**
   * `route` and `middleware` for h3 handlers, `fetch` for an outgoing request,
   * `compile` for a module Vite compiled, and the rest for the Nuxt
   * channel of the same name.
   */
  kind: 'route' | 'middleware' | 'fetch' | 'hook' | 'plugin' | 'data' | 'render' | 'island' | 'compile'
  /** What ran: a hook, plugin or data key, or `METHOD url` for a request. */
  name: string
  /** Epoch milliseconds, fractional. */
  start: number
  duration: number
  status?: number
  error?: boolean
  /** For `compile`: the Vite environment the module was compiled for. */
  environment?: string
  /** For `compile`: milliseconds each Vite plugin spent on the module, excluding nested calls. */
  plugins?: Record<string, number>
  /** For `compile`: fetched while other app requests were also in flight. */
  shared?: boolean
}

/** Where `runtime/dev-request-context.mjs` sends the spans it times. */
const DEV_SPAN_CHANNEL = 'nuxt:dev:span'

/** Receive the app's spans until the returned function is called. */
export function openDevSpanChannel(sink: (span: DevRequestSpan) => void): () => void {
  const channel = openBroadcast(DEV_SPAN_CHANNEL, sink)
  return () => channel?.close()
}
