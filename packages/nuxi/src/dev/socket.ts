import type { RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { Server } from 'node:http'
import os from 'node:os'
import process from 'node:process'
import { join } from 'pathe'

function generateSocketPath(prefix: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)

  if (process.platform === 'win32') {
    // Windows named pipes
    return `\\\\.\\pipe\\${prefix}-${timestamp}-${random}`
  }

  // Unix domain sockets
  return join(os.tmpdir(), `${prefix}-${timestamp}-${random}.sock`)
}

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

export async function createSocketListener(handler: RequestListener, proxyAddress?: AddressInfo) {
  const socketPath = generateSocketPath('nuxt-dev')
  const server = new Server(handler)

  if (process.platform !== 'win32' && existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    }
    catch {
      // suppress errors if the socket file cannot be removed
    }
  }
  await new Promise<void>(resolve => server.listen({ path: socketPath }, resolve))
  const url = formatSocketURL(socketPath)
  return {
    url,
    address: { address: 'localhost', port: 3000, ...proxyAddress, socketPath },
    async close() {
      try {
        server.removeAllListeners()
        await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
      }
      finally {
        // Clean up socket file on Unix systems
        if (process.platform !== 'win32') {
          try {
            unlinkSync(socketPath)
          }
          catch {
            // suppress errors
          }
        }
      }
    },
    getURLs: async () => [{ url, type: 'network' as const }],
    https: false as const,
    server,
  }
}
