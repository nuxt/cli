/** Status codes worth a second attempt: transient overload, throttling and gateway faults. */
const RETRY_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])

export interface FetchJsonOptions {
  headers?: Record<string, string>
  /** Milliseconds before the request is aborted. Unlimited when omitted. */
  timeout?: number
  /** Extra attempts after the first. Defaults to one. */
  retry?: number
}

interface FetchJsonError extends Error {
  status: number
  response: Response
}

/**
 * `GET` a JSON document, throwing on a non-2xx response.
 *
 * Errors carry `status` and `response` so `classifyNetworkError` can tell an HTTP
 * failure from a transport failure. Transport errors and the status codes above
 * are retried, since `fetch` itself will not.
 *
 * This module deliberately has no imports: it is loaded directly by
 * `scripts/generate-data.ts` under Node's type stripping, where extensionless
 * relative specifiers do not resolve.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const attempts = (options.retry ?? 1) + 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: options.headers,
        signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
      })
      if (response.ok) {
        return await response.json() as T
      }
      lastError = Object.assign(
        new Error(`Request to ${url} failed with ${response.status} ${response.statusText}`),
        { status: response.status, response },
      ) satisfies FetchJsonError
      if (!RETRY_STATUS_CODES.has(response.status)) {
        break
      }
    }
    catch (error) {
      lastError = error
      // A timeout is a deliberate deadline, so retrying would silently double it.
      const name = (error as Error | undefined)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        break
      }
    }
  }
  throw lastError
}
