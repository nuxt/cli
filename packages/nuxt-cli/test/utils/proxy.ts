import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import http, { createServer } from 'node:http'
import { connect } from 'node:net'

export const setGlobalProxyFromEnv = (http as { setGlobalProxyFromEnv?: (env: NodeJS.ProcessEnv) => () => void }).setGlobalProxyFromEnv

function listen(server: Server) {
  return new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

/**
 * Start a CONNECT proxy that tunnels every request to a local server responding
 * with `ok`, recording the requested `host:port` of each tunnel.
 */
export async function startTunnelProxy() {
  const tunnelled: string[] = []
  const target = createServer((_req, res) => res.end('ok'))
  const proxy = createServer()
  const [proxyPort, targetPort] = await Promise.all([listen(proxy), listen(target)])
  proxy.on('connect', (req, socket) => {
    tunnelled.push(req.url!)
    const upstream = connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(socket).pipe(upstream)
    })
  })
  const restoreDispatcher = setGlobalProxyFromEnv?.({})

  return {
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    targetUrl: `http://127.0.0.1:${targetPort}/`,
    tunnelled,
    close() {
      restoreDispatcher?.()
      for (const server of [proxy, target]) {
        server.closeAllConnections()
        server.close()
      }
    },
  }
}
