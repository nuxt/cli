import type { RequestListener } from 'node:http'
import { Server } from 'node:http'
import process from 'node:process'

import { cleanSocket, getSocketAddress } from 'get-port-please'

export function formatSocketURL(socketPath: string, ssl = false): string {
  const protocol = ssl ? 'https' : 'http'
  if (process.platform === 'win32') {
    // Windows named pipes need special encoding
    const encodedPath = encodeURIComponent(socketPath)
    return `${protocol}+unix://${encodedPath}`
  }

  // Unix sockets can use the unix: protocol
  return `${protocol}+unix://${socketPath.replace(/\//g, '%2F')}`
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

export async function createSocketListener(handler: RequestListener, ssl = false) {
  const socketPath = getSocketAddress({
    name: 'nuxt-dev',
    random: true,
  })
  const server = new Server(handler)
  await cleanSocket(socketPath)
  await new Promise<void>(resolve => server.listen({ path: socketPath }, resolve))
  const url = formatSocketURL(socketPath, ssl)
  return {
    url,
    address: {
      socketPath,
      address: 'localhost',
      port: 3000,
    },
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
