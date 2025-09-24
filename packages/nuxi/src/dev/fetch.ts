import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { Agent } from 'undici'

export interface DevAddress {
  socketPath?: string
  host?: string
  port?: number
}

/**
 * Create fetch options for socket-based communication
 * Based on Nitro's fetchSocketOptions implementation
 */
export function fetchSocketOptions(socketPath: string) {
  if ('Bun' in globalThis) {
    // https://bun.sh/guides/http/fetch-unix
    return { unix: socketPath }
  }
  if ('Deno' in globalThis) {
    // https://github.com/denoland/deno/pull/29154
    return {
      client: (globalThis as any).Deno.createHttpClient({
        transport: 'unix',
        path: socketPath,
      }),
    }
  }
  // https://github.com/nodejs/undici/issues/2970
  return {
    dispatcher: new Agent({ connect: { socketPath } }),
  }
}

/**
 * Fetch to a specific address (socket or network)
 * Based on Nitro's fetchAddress implementation
 */
export function fetchAddress(
  addr: DevAddress,
  input: string | URL | Request,
  inputInit?: RequestInit,
): Promise<Response> {
  let url: URL
  let init: (RequestInit & { duplex?: string }) | undefined

  if (input instanceof Request) {
    url = new URL(input.url)
    init = {
      method: input.method,
      headers: input.headers,
      body: input.body,
      ...inputInit,
    }
  }
  else {
    url = new URL(input)
    init = inputInit
  }

  init = {
    duplex: 'half',
    redirect: 'manual',
    ...init,
  }

  if (addr.socketPath) {
    url.protocol = 'http:'
    return fetch(url, {
      ...init,
      ...fetchSocketOptions(addr.socketPath),
    })
  }

  const origin = `http://${addr.host}${addr.port ? `:${addr.port}` : ''}`
  const outURL = new URL(url.pathname + url.search, origin)
  return fetch(outURL, init)
}

/**
 * Convert Node.js IncomingMessage to Web API Request
 */
export function nodeRequestToWebRequest(req: IncomingMessage): Request {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v)
        }
      }
      else {
        headers.set(key, value)
      }
    }
  }

  const init: RequestInit & { duplex?: string } = {
    method: req.method || 'GET',
    headers,
  }

  // Add body for non-GET methods
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req as any // Node.js readable stream
    init.duplex = 'half'
  }

  return new Request(url, init)
}

/**
 * Send Web API Response to Node.js ServerResponse
 */
export async function sendWebResponse(res: ServerResponse, webResponse: Response): Promise<void> {
  // Set status
  res.statusCode = webResponse.status
  res.statusMessage = webResponse.statusText

  // Set headers
  for (const [key, value] of webResponse.headers.entries()) {
    res.setHeader(key, value)
  }

  // Stream body
  if (webResponse.body) {
    const reader = webResponse.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        res.write(value)
      }
    }
    finally {
      reader.releaseLock()
    }
  }

  res.end()
}

export function createFetchHandler(
  getAddress: () => DevAddress | undefined,
  onError: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  onLoading: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): RequestListener {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const address = getAddress()

      if (!address) {
        await onLoading(req, res)
        return
      }

      const webRequest = nodeRequestToWebRequest(req)
      const webResponse = await fetchAddress(address, webRequest)
      await sendWebResponse(res, webResponse)
    }
    catch (error) {
      console.error('Fetch handler error:', error)
      await onError(req, res)
    }
  }
}
