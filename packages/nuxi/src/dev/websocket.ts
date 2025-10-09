import type { Buffer } from 'node:buffer'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { connect } from 'node:net'

export function connectToChildSocket(
  socketPath: string,
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): void {
  const childSocket = connect(socketPath)

  let isConnected = false

  childSocket.on('error', (error) => {
    const errorMessage = error.message || ''
    if (!errorMessage.includes('ECONNRESET') && !errorMessage.includes('EPIPE') && !errorMessage.includes('premature close')) {
      console.error('Child socket connection error:', error)
    }
    if (!clientSocket.destroyed) {
      clientSocket.destroy()
    }
  })

  clientSocket.on('error', (error) => {
    const errorMessage = error.message || ''
    if (!errorMessage.includes('ECONNRESET') && !errorMessage.includes('EPIPE') && !isConnected) {
      console.error('Client socket error:', error)
    }
    if (!childSocket.destroyed) {
      childSocket.destroy()
    }
  })

  childSocket.on('connect', () => {
    isConnected = true
    // Forward the HTTP upgrade request
    const requestLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    const headers = Object.entries(req.headers)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map(v => `${key}: ${v}`).join('\r\n')
        }
        return `${key}: ${value}`
      })
      .join('\r\n')

    const httpRequest = `${requestLine}${headers}\r\n\r\n`

    // Send HTTP upgrade request
    childSocket.write(httpRequest)

    // Send any buffered data (head)
    if (head && head.length > 0) {
      childSocket.write(head)
    }

    // Pipe data bidirectionally
    clientSocket.pipe(childSocket)
    childSocket.pipe(clientSocket)
  })

  // Clean up on close
  const cleanup = () => {
    if (!clientSocket.destroyed) {
      clientSocket.destroy()
    }
    if (!childSocket.destroyed) {
      childSocket.destroy()
    }
  }

  clientSocket.on('close', cleanup)
  childSocket.on('close', cleanup)
}

/**
 * Connect to child process via network address for WebSocket upgrades
 * Fallback for non-socket addresses
 */
export function connectToChildNetwork(
  host: string,
  port: number,
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): void {
  const childSocket = connect(port, host)

  let isConnected = false

  childSocket.on('error', (error) => {
    const errorMessage = error.message || ''
    if (!errorMessage.includes('ECONNRESET') && !errorMessage.includes('EPIPE') && !errorMessage.includes('premature close')) {
      console.error('Child network connection error:', error)
    }
    if (!clientSocket.destroyed) {
      clientSocket.destroy()
    }
  })

  clientSocket.on('error', (error) => {
    const errorMessage = error.message || ''
    if (!errorMessage.includes('ECONNRESET') && !errorMessage.includes('EPIPE') && !isConnected) {
      console.error('Client socket error:', error)
    }
    if (!childSocket.destroyed) {
      childSocket.destroy()
    }
  })

  childSocket.on('connect', () => {
    isConnected = true
    // Forward the HTTP upgrade request
    const requestLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    const headers = Object.entries(req.headers)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map(v => `${key}: ${v}`).join('\r\n')
        }
        return `${key}: ${value}`
      })
      .join('\r\n')

    const httpRequest = `${requestLine}${headers}\r\n\r\n`

    // Send HTTP upgrade request
    childSocket.write(httpRequest)

    // Send any buffered data (head)
    if (head && head.length > 0) {
      childSocket.write(head)
    }

    // Pipe data bidirectionally
    clientSocket.pipe(childSocket)
    childSocket.pipe(clientSocket)
  })

  // Clean up on close
  const cleanup = () => {
    if (!clientSocket.destroyed) {
      clientSocket.destroy()
    }
    if (!childSocket.destroyed) {
      childSocket.destroy()
    }
  }

  clientSocket.on('close', cleanup)
  childSocket.on('close', cleanup)
}
