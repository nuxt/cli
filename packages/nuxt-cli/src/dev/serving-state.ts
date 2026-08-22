import { AsyncLocalStorage } from 'node:async_hooks'

export interface InflightRequest {
  id: number
  label: string
}

const storage = new AsyncLocalStorage<InflightRequest>()

/** Carries the request across the boundary the async context cannot cross. */
export const REQUEST_HEADER = 'x-nuxt-dev-request-id'

let nextId = 0

/**
 * Serve `run` inside a context that identifies the request, so any log it causes
 * can be attributed to it.
 *
 * The dev server, the build tooling and the app all log through the same consola
 * on the same thread, so the call site says nothing about who is logging.
 *
 * The context reaches everything on the handler's own async chain, timers and
 * microtasks included, but not the app: Nuxt's dev pipeline re-dispatches
 * through the Vite module runner, which is a message boundary rather than an
 * async one. The app's own logs are attributed by
 * `runtime/dev-request-context.mjs` instead.
 */
export function runWithRequest<T>(label: string, run: (request: InflightRequest) => T): T {
  const request: InflightRequest = { id: ++nextId, label }
  return storage.run(request, () => run(request))
}

/** The value of {@link REQUEST_HEADER} for `request`. */
export function encodeRequest(request: InflightRequest): string {
  return `${request.id} ${request.label}`
}

/** Whether this code is running to serve a request, rather than to build. */
export function isServingRequest(): boolean {
  return storage.getStore() !== undefined
}

/**
 * The request being served on this call stack, if any.
 *
 * Absent rather than guessed once the context has been lost, which happens when
 * work a request started is finished on a queue the handler does not own.
 */
export function currentRequest(): InflightRequest | undefined {
  return storage.getStore()
}
