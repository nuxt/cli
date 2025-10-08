import type { RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from 'node:http'
import process from 'node:process'

import { cleanSocket, getSocketAddress } from 'get-port-please'

export function formatSocketURL(socketPath: string, ssl = false): string {
  const protocol = ssl ? 'https' : 'http'
  // Windows named pipes need special encoding
  const encodedPath = process.platform === 'win32'
    ? encodeURIComponent(socketPath)
    : socketPath.replace(/\//g, '%2F')
  return `${protocol}+unix://${encodedPath}`
}

export function isSocketURL(url: string): boolean {
  return url.startsWith('http+unix://') || url.startsWith('https+unix://')
}

export function parseSocketURL(url: string): { socketPath: string, protocol: 'https' | 'http' } {
  if (!isSocketURL(url)) {
    throw new Error(`Invalid socket URL: ${url}`)
  }

  const ssl = url.startsWith('https+unix://')
  const path = url.slice(ssl ? 'https+unix://'.length : 'http+unix://'.length)
  const socketPath = decodeURIComponent(path.replace(/%2F/g, '/'))

  return { socketPath, protocol: ssl ? 'https' : 'http' }
}

export async function createSocketListener(handler: RequestListener, proxyAddress?: AddressInfo | { socketPath: string }) {
  const socketPath = getSocketAddress({
    name: 'nuxt-dev',
    random: true,
  })
  const server = new Server(handler)
  await cleanSocket(socketPath)
  await new Promise<void>(resolve => server.listen({ path: socketPath }, resolve))
  const url = formatSocketURL(socketPath)
  return {
    url,
    address: { address: 'localhost', port: 3000, family: 'IPv4', ...proxyAddress, socketPath },
    async close() {
      try {
        server.removeAllListeners()
        await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
      }
      finally {
        await cleanSocket(socketPath)
      }
    },
    getURLs: async () => [{ url, type: 'network' as const }],
    https: false as const,
    server,
  }
}
