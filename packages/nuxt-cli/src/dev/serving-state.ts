import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export interface InflightRequest {
  id: string
  label: string
}

const storage = new AsyncLocalStorage<InflightRequest>()

/** Carries the request across the boundary the async context cannot cross. */
export const REQUEST_HEADER = 'x-nuxt-dev-request-id'

/** Carries the request's `METHOD /path` alongside {@link REQUEST_HEADER}. */
export const REQUEST_LABEL_HEADER = 'x-nuxt-dev-request-label'

/**
 * Identify a request, so logs and reports can be attributed to it.
 *
 * The id is random because it also scopes who may read the request's report.
 */
export function createRequest(label: string): InflightRequest {
  return { id: randomUUID(), label }
}

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
export function runWithRequest<T>(request: InflightRequest | string, run: (request: InflightRequest) => T): T {
  const inflight = typeof request === 'string' ? createRequest(request) : request
  return storage.run(inflight, () => run(inflight))
}

/** The value of {@link REQUEST_LABEL_HEADER} for `request`, encoded for a header. */
export function encodeRequestLabel(request: InflightRequest): string {
  return encodeURIComponent(request.label)
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
