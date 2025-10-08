import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { NodeRequest } from 'srvx/node'
import { isWindows } from 'std-env'
import { Agent } from 'undici'

interface DevAddress {
  socketPath?: string
  host?: string
  port?: number
}

/**
 * Create fetch options for socket-based communication
 * Based on Nitro's fetchSocketOptions implementation
 */
function fetchSocketOptions(socketPath: string) {
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

interface NodeHttpResponse {
  status: number
  statusText: string
  headers: Headers
  body: Readable
}
/**
 * fetch using native Node.js http.request for Windows named pipes
 * this bypasses undici's Web Streams which have buffering issues on Windows
 */
function fetchWithNodeHttp(socketPath: string, url: URL, init?: RequestInit & { duplex?: string }): Promise<NodeHttpResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        for (const [key, value] of init.headers.entries()) {
          headers[key] = value
        }
      }
      else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value
        }
      }
      else {
        Object.assign(headers, init.headers)
      }
    }

    const req = httpRequest({
      socketPath,
      path: url.pathname + url.search,
      method: init?.method || 'GET',
      headers,
    }, (res) => {
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(res.headers)) {
        if (value !== undefined) {
          responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
      }

      resolve({
        status: res.statusCode || 200,
        statusText: res.statusMessage || 'OK',
        headers: responseHeaders,
        body: res,
      })
    })

    req.on('error', reject)

    if (init?.body) {
      if (typeof init.body === 'string') {
        req.write(init.body)
      }
      else if (init.body instanceof ReadableStream) {
        const reader = init.body.getReader()
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                break
              }
              req.write(value)
            }
            req.end()
          }
          catch (err) {
            req.destroy(err as Error)
          }
        }
        pump()
        return
      }
    }

    req.end()
  })
}

/**
 * Fetch to a specific address (socket or network)
 * Based on Nitro's fetchAddress implementation
 */
function fetchAddress(
  addr: DevAddress,
  input: string | URL | Request,
  inputInit?: RequestInit,
): Promise<Response | NodeHttpResponse> {
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

  if (addr.socketPath && isWindows) {
    url.protocol = 'http:'
    return fetchWithNodeHttp(addr.socketPath, url, init)
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
 * Send Web API Response to Node.js ServerResponse
 */
async function sendWebResponse(res: ServerResponse, webResponse: Response | NodeHttpResponse): Promise<void> {
  // Set status
  res.statusCode = webResponse.status
  res.statusMessage = webResponse.statusText

  // Set headers
  for (const [key, value] of webResponse.headers.entries()) {
    res.setHeader(key, value)
  }

  // Stream body
  if (webResponse.body) {
    // handle node readable stream (from Windows named pipe fetch)
    if (webResponse.body instanceof Readable) {
      try {
        await pipeline(webResponse.body, res, { end: true })
      }
      catch (error) {
        if (!res.writableEnded) {
          res.end()
        }
        throw error
      }
      return
    }

    const reader = webResponse.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        // backpressure
        if (!res.write(value)) {
          await new Promise<void>(resolve => res.once('drain', resolve))
        }
      }
    }
    catch (error) {
      // If streaming fails, clean up and end the response
      reader.releaseLock()
      if (!res.writableEnded) {
        res.end()
      }
      throw error
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

      const webRequest = new NodeRequest({ req, res })
      const webResponse = await fetchAddress(address, webRequest)
      await sendWebResponse(res, webResponse)
    }
    catch (error) {
      console.error('Fetch handler error:', error)
      await onError(req, res)
    }
  }
}
