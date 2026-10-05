import type { IncomingMessage } from 'node:http'

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export interface InflightRequest {
  id: string
  label: string
}

const storage = new AsyncLocalStorage<InflightRequest>()

/** Carries the request across the boundary the async context cannot cross. */
const REQUEST_HEADER = 'x-nuxt-dev-request-id'

/** Carries the request's `METHOD /path`, URI-encoded, alongside {@link REQUEST_HEADER}. */
const REQUEST_LABEL_HEADER = 'x-nuxt-dev-request-label'

/**
 * Identify a request, so logs and reports can be attributed to it.
 *
 * The id is random because it also scopes who may read the request's report.
 */
export function createRequest(label: string): InflightRequest {
  return { id: randomUUID(), label }
}

/** Stamp `req` with a fresh identity, overwriting any client-supplied copy in `headers` and `rawHeaders`. */
export function attachRequest(req: IncomingMessage): InflightRequest {
  if (req.headers[REQUEST_HEADER] !== undefined || req.headers[REQUEST_LABEL_HEADER] !== undefined) {
    for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
      const name = req.rawHeaders[i]?.toLowerCase()
      if (name === REQUEST_HEADER || name === REQUEST_LABEL_HEADER) {
        req.rawHeaders.splice(i, 2)
      }
    }
  }
  const request = createRequest(`${req.method || 'GET'} ${req.url || '/'}`)
  const label = encodeURIComponent(request.label)
  req.headers[REQUEST_HEADER] = request.id
  req.headers[REQUEST_LABEL_HEADER] = label
  req.rawHeaders.push(REQUEST_HEADER, request.id, REQUEST_LABEL_HEADER, label)
  return request
}

/**
 * Serve `run` inside a context that identifies the request, so any log it causes
 * can be attributed to it.
 *
 * The context reaches everything on the handler's own async chain, timers and
 * microtasks included, but not the app: Nuxt's dev pipeline re-dispatches
 * through the Vite module runner, which is a message boundary rather than an
 * async one. The app's own logs are attributed by
 * `runtime/dev-request-context.mjs` instead.
 */
export function runWithRequest<T>(request: InflightRequest, run: () => T): T {
  return storage.run(request, run)
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
