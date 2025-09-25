import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { NodeRequest } from 'srvx/node'
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

/**
 * Fetch to a specific address (socket or network)
 * Based on Nitro's fetchAddress implementation
 */
function fetchAddress(
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
 * Send Web API Response to Node.js ServerResponse
 */
async function sendWebResponse(res: ServerResponse, webResponse: Response): Promise<void> {
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
