import type { ChildProcess } from 'node:child_process'
import type { Server, Socket } from 'node:net'

import type { NuxtDevIPCMessage } from './dev'
import { EventEmitter } from 'node:events'
import { unlink } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { join } from 'pathe'

export interface SocketIPCOptions {
  socketPath: string
}

export function isAbstractSocket(socketPath: string): boolean {
  return process.platform === 'linux' && socketPath.startsWith('\0')
}

/**
 * Generate a platform-specific socket path
 */
export function generateSocketPath(prefix = 'nuxt-dev'): string {
  const timestamp = Date.now()
  const pid = process.pid

  if (process.platform === 'win32') {
    // Named pipes on Windows
    return `\\\\.\\pipe\\${prefix}-${pid}-${timestamp}`
  }
  else if (process.platform === 'linux') {
    // Abstract sockets on Linux (starts with null byte)
    return `\0${prefix}-${pid}-${timestamp}`
  }
  else {
    // Unix domain sockets on other POSIX systems (macOS, BSD, etc.)
    const socketName = `${prefix}-${pid}-${timestamp}.sock`

    // Use OS temp directory which is guaranteed to be writable
    return join(tmpdir(), socketName)
  }
}

/**
 * Server-side socket IPC (Parent process)
 */
export class SocketIPCServer extends EventEmitter {
  private server: Server | null = null
  private clients: Set<Socket> = new Set()
  public readonly socketPath: string

  constructor(socketPath?: string) {
    super()
    this.socketPath = socketPath || generateSocketPath()
  }

  async start(): Promise<void> {
    // Clean up any existing socket file (Unix domain sockets only, not abstract sockets)
    if (process.platform !== 'win32' && process.platform !== 'linux') {
      try {
        await unlink(this.socketPath)
      }
      catch {
        // Ignore if file doesn't exist
      }
    }
    // Note: Abstract sockets on Linux (starting with \0) don't need cleanup

    this.server = createServer((socket) => {
      this.clients.add(socket)

      socket.on('data', (data) => {
        try {
          const messages = data.toString().trim().split('\n')
          for (const messageStr of messages) {
            if (messageStr) {
              const message: NuxtDevIPCMessage = JSON.parse(messageStr)
              this.emit('message', message)
            }
          }
        }
        catch (error) {
          this.emit('error', new Error(`Failed to parse IPC message: ${error}`))
        }
      })

      socket.on('close', () => {
        this.clients.delete(socket)
      })

      socket.on('error', (error) => {
        this.emit('error', error)
        this.clients.delete(socket)
      })
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(this.socketPath, () => {
        resolve()
      })

      this.server!.on('error', (error) => {
        reject(error)
      })
    })
  }

  send(message: NuxtDevIPCMessage): void {
    const data = `${JSON.stringify(message)}\n`
    for (const client of this.clients) {
      try {
        client.write(data)
      }
      catch (error) {
        this.emit('error', error)
        this.clients.delete(client)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      // Close all client connections
      for (const client of this.clients) {
        client.destroy()
      }
      this.clients.clear()

      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          resolve()
        })
      })

      // Clean up socket file (abstract sockets on Linux utomatically cleaned up by kernel)
      if (process.platform !== 'win32' && process.platform !== 'linux') {
        try {
          await unlink(this.socketPath)
        }
        catch {
          // Ignore if already cleaned up
        }
      }
    }
  }
}

/**
 * Client-side socket IPC (Child process)
 */
export class SocketIPCClient extends EventEmitter {
  private socket: Socket | null = null
  public readonly socketPath: string

  constructor(socketPath: string) {
    super()
    this.socketPath = socketPath
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection(this.socketPath)

      this.socket.on('connect', () => {
        resolve()
      })

      this.socket.on('data', (data) => {
        try {
          const messages = data.toString().trim().split('\n')
          for (const messageStr of messages) {
            if (messageStr) {
              const message: NuxtDevIPCMessage = JSON.parse(messageStr)
              this.emit('message', message)
            }
          }
        }
        catch (error) {
          this.emit('error', new Error(`Failed to parse IPC message: ${error}`))
        }
      })

      this.socket.on('error', (error) => {
        reject(error)
      })

      this.socket.on('close', () => {
        this.emit('close')
      })
    })
  }

  send(message: NuxtDevIPCMessage): void {
    if (this.socket && this.socket.writable) {
      const data = `${JSON.stringify(message)}\n`
      this.socket.write(data)
    }
    else {
      this.emit('error', new Error('Socket not connected'))
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
  }
}

/**
 * Hybrid IPC manager that can fallback to built-in Node.js IPC
 */
export class HybridIPCManager {
  useBuiltinIPC: boolean = false
  logger: { info: (msg: string) => void }
  private socketServer?: SocketIPCServer
  private socketClient?: SocketIPCClient
  private childProcess?: ChildProcess
  private initialised: boolean = false

  constructor(private isParent: boolean, private socketPath?: string, logger?: { info: (msg: string) => void }) {
    this.logger = logger || console
  }

  async initialize(childProcess?: ChildProcess): Promise<void> {
    this.childProcess = childProcess

    if (this.initialised) {
      return
    }

    try {
      if (this.isParent) {
        // Parent process - start socket server
        this.socketServer = new SocketIPCServer(this.socketPath)
        await this.socketServer.start()

        // Forward socket messages as events
        this.socketServer.on('message', (message) => {
          this.emit('message', message)
        })

        this.socketServer.on('error', (error) => {
          this.emit('error', error)
        })
      }
      else {
        // Child process - connect to socket server
        if (!this.socketPath) {
          throw new Error('Socket path required for child process')
        }

        this.socketClient = new SocketIPCClient(this.socketPath)
        await this.socketClient.connect()

        // Forward socket messages as events
        this.socketClient.on('message', (message) => {
          this.emit('message', message)
        })

        this.socketClient.on('error', (error) => {
          this.emit('error', error)
        })
      }
      this.initialised = true
    }
    catch (error) {
      // Fallback to built-in IPC
      console.warn('Socket IPC failed, falling back to built-in IPC:', error)
      this.useBuiltinIPC = true
      this.setupBuiltinIPC()
    }
  }

  private setupBuiltinIPC(): void {
    if (this.isParent && this.childProcess) {
      // Parent listening to child messages
      this.childProcess.on('message', (message) => {
        this.emit('message', message)
      })
    }
    else if (!this.isParent && process.send) {
      // Child listening to parent messages (not commonly used in current implementation)
      process.on('message', (message) => {
        this.emit('message', message)
      })
    }
  }

  send<T extends NuxtDevIPCMessage>(message: T): void {
    if (this.useBuiltinIPC) {
      if (this.isParent && this.childProcess) {
        this.childProcess.send?.(message)
      }
      else if (!this.isParent && process.send) {
        process.send(message)
      }
      else {
        // Final fallback to logging
        this.logMessage(message)
      }
    }
    else {
      // Socket IPC mode with auto-fallback
      try {
        if (this.socketServer) {
          this.socketServer.send(message)
        }
        else if (this.socketClient) {
          this.socketClient.send(message)
        }
        else {
          throw new Error('No active socket connection')
        }
      }
      catch (error) {
        // Auto-switch to built-in IPC and retry
        console.warn('Socket IPC failed, switching to built-in IPC:', error)
        this.useBuiltinIPC = true
        this.setupBuiltinIPC()
        this.send(message) // Retry with built-in IPC
      }
    }
  }

  private logMessage(message: NuxtDevIPCMessage): void {
    const logMsg = `Dev server event: ${Object.entries(message)
      .map(e => `${e[0]}=${JSON.stringify(e[1])}`)
      .join(' ')}`

    this.logger.info(logMsg)
  }

  getSocketPath(): string | undefined {
    return this.socketServer?.socketPath || this.socketClient?.socketPath
  }

  async cleanup(): Promise<void> {
    if (this.socketServer) {
      await this.socketServer.stop()
    }
    if (this.socketClient) {
      this.socketClient.disconnect()
    }
  }

  // EventEmitter implementation
  private events: Record<string, ((...args: any[]) => void)[]> = {}

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(listener)
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this.events[event]
    if (listeners) {
      listeners.forEach(listener => listener(...args))
      return true
    }
    return false
  }
}
