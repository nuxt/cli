import type { ChildProcess } from 'node:child_process'
import type { MessageEvent } from 'undici'
import type { TestOptions } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { fileURLToPath } from 'node:url'
import { getPort, waitForPort } from 'get-port-please'
import { isCI, isLinux, isMacOS, isWindows } from 'std-env'
import { WebSocket } from 'undici'
import { it as _it, afterAll, beforeAll, describe, expect, vi } from 'vitest'

const playgroundDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxiPath = join(fileURLToPath(new URL('../..', import.meta.url)), 'bin/nuxi.mjs')

const runtimes = ['bun', 'node', 'deno'] as const

const platform = {
  windows: isWindows,
  linux: isLinux,
  macos: isMacOS,
}

const runtime = {
  bun: spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0,
  deno: spawnSync('deno', ['--version'], { stdio: 'ignore' }).status === 0,
  node: true,
}

type SupportStatus = boolean | {
  start: boolean
  fetching: boolean
  websockets: boolean
}

function createIt(runtimeName: typeof runtimes[number]) {
  function it(description: string, fn: () => Promise<void>): void
  function it(description: string, options: TestOptions, fn: () => Promise<void>): void
  function it(description: string, _options: TestOptions | (() => Promise<void>), _fn?: () => Promise<void>): void {
    const supportMatrix: Record<typeof runtimes[number], SupportStatus> = {
      node: true,
      bun: {
        start: true,
        fetching: true,
        // https://github.com/nitrojs/nitro/issues/2721
        websockets: false,
      },
      deno: {
        start: true,
        fetching: !platform.windows,
        websockets: !platform.windows,
      },
    }
    const status = supportMatrix[runtimeName]

    const fn = typeof _options === 'function' ? _options : _fn!
    const options = typeof _options === 'function' ? {} : _options

    if (status === false) {
      return _it.fails(`${description} [expected to fail with ${runtimeName}]`, options, fn)
    }
    if (status === true) {
      return _it(description, options, fn)
    }
    if (description.includes('should start dev server')) {
      if (!status.start) {
        return _it.fails(description, options, fn)
      }
      return beforeAll(fn, options.timeout)
    }
    if (!status.start) {
      return _it.todo(description)
    }
    if (description.includes('websocket')) {
      if (!status.websockets) {
        return _it.fails(`${description} [expected to fail with ${runtimeName}]`, options, fn)
      }
      return _it(description, options, fn)
    }
    // Handle fetching tests (all tests that are not websocket or start tests)
    if (!status.fetching) {
      return _it.fails(description, options, fn)
    }
    return _it(description, options, fn)
  }

  return it
}

describe.sequential.each(runtimes)('dev server (%s)', (runtimeName) => {
  let server: DevServerInstance

  if (!isCI && !runtime[runtimeName]) {
    console.warn(`Not testing locally with ${runtimeName} as it is not installed.`)
    _it.skip(`should pass with ${runtimeName}`)
    return
  }

  const cwd = resolve(playgroundDir, `../playground-${runtimeName}`)

  afterAll(async () => {
    await server?.close()
    await rm(cwd, { recursive: true, force: true }).catch(() => null)
  })

  const it = createIt(runtimeName)

  it('should start dev server', { timeout: isCI ? 120_000 : 30_000 }, async () => {
    rmSync(cwd, { recursive: true, force: true })
    cpSync(playgroundDir, cwd, {
      recursive: true,
      filter: src => !src.includes('.nuxt') && !src.includes('.output') && !src.includes('node_modules'),
    })
    server = await startDevServer({
      cwd,
      runtime: runtimeName,
    })
  })

  it('should serve the main page', async () => {
    const response = await fetch(server.url)
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain('Welcome to the Nuxt CLI playground')
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('should serve static assets', async () => {
    const response = await fetch(`${server.url}/favicon.ico`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/')
  })

  it('should handle API routes', async () => {
    const response = await fetch(`${server.url}/api/hello`)
    expect(response.status).toBe(200)
  })

  it('should handle POST requests', async () => {
    const response = await fetch(`${server.url}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' }),
    })

    expect(response.status).toBe(200)
  })

  it('should preserve request headers', async () => {
    const headers = {
      'X-Custom-Header': 'test-value',
      'User-Agent': 'vitest',
    }

    const res = await fetch(`${server.url}/api/echo`, { headers })
    const { headers: receivedHeaders } = await res.json()

    expect(receivedHeaders).toMatchObject({
      'user-agent': 'vitest',
      'x-custom-header': 'test-value',
    })

    expect(res.status).toBe(200)
  })

  it('should handle concurrent requests', async () => {
    const requests = Array.from({ length: 5 }, () => fetch(server.url))
    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Welcome to the Nuxt CLI playground')
    }
  })

  it('should handle large request payloads', async () => {
    const largePayload = { data: 'x'.repeat(10_000) }
    const response = await fetch(`${server.url}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(largePayload),
    })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.echoed.data).toBe(largePayload.data)
  })

  it('should handle different HTTP methods', async () => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE']

    for (const method of methods) {
      const response = await fetch(`${server.url}/api/hello`, { method })
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.method).toBe(method)
    }
  })

  it('should establish websocket connection and handle ping/pong', async () => {
    const wsUrl = `${server.url.replace('http', 'ws')}/_ws`

    let isConnected = false
    let receivedPong = false

    await createWebSocketTest({
      url: wsUrl,
      timeout: 2_000,
      testId: 'ping/pong',
      onOpen: (ws) => {
        isConnected = true
        ws.send('ping test message')
      },
      onMessage: (ws, event) => {
        const message = event.data.toString()
        if (message === 'pong') {
          receivedPong = true
          ws.close()
        }
      },
      onClose: () => isConnected && receivedPong,
    })
  })

  it('should handle multiple concurrent websocket connections', async () => {
    const wsUrl = `${server.url.replace('http', 'ws')}/_ws`
    const connectionCount = 2

    const connectionPromises = Array.from({ length: connectionCount }, (_, index) => {
      let receivedPong = false

      return createWebSocketTest({
        url: wsUrl,
        timeout: 2_000,
        testId: `concurrent connection ${index}`,
        onOpen: (ws) => {
          ws.send(`ping from connection ${index}`)
        },
        onMessage: (ws, event) => {
          if (event.data.toString() === 'pong') {
            receivedPong = true
            ws.close()
          }
        },
        onClose: () => receivedPong,
      })
    })

    await Promise.all(connectionPromises)
  })
})

interface DevServerInstance {
  process: ChildProcess
  url: string
  port: number
  close: () => Promise<void>
}

async function startDevServer(options: {
  cwd: string
  port?: number
  runtime?: 'node' | 'bun' | 'deno'
  env?: Record<string, string>
}): Promise<DevServerInstance> {
  const { cwd, port: preferredPort, runtime = 'node', env = {} } = options
  const port = preferredPort || await getPort({ port: 3100 })
  const host = '127.0.0.1'
  const url = `http://${host}:${port}`

  let command: string
  switch (runtime) {
    case 'bun':
      command = `bun ${nuxiPath} dev --port ${port} --host ${host}`
      break
    case 'deno':
      command = `deno run --allow-all ${nuxiPath} dev --port ${port} --host ${host}`
      break
    default:
      command = `node ${nuxiPath} dev --port ${port} --host ${host}`
  }

  const [cmd, ...args] = command.split(' ')

  // Start the dev server process
  const child = spawn(cmd!, args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      ...env,
      NUXT_TELEMETRY_DISABLED: '1',
      PORT: String(port),
      HOST: host,
    },
  })

  try {
    await waitForPort(port, { delay: 1000, retries: 25, host })
    await vi.waitFor(async () => {
      const res = await fetch(url)
      if (res.status === 503) {
        throw new Error('Server not ready')
      }
    }, { timeout: isCI ? 60_000 : 30_000 })
  }
  catch (error) {
    child.kill()
    throw new Error(`Dev server failed to start on port ${port} with ${runtime}: ${error}`)
  }

  return {
    process: child,
    url,
    port,
    close: async () => {
      return new Promise<void>((resolve) => {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 5000)
        child.on('exit', () => resolve())
      })
    },
  }
}

interface WebSocketTestOptions {
  url: string
  timeout?: number
  onOpen?: (ws: WebSocket) => void
  onMessage?: (ws: WebSocket, event: MessageEvent) => void
  onClose?: (ws: WebSocket, event: CloseEvent) => boolean // return true if test should complete successfully
  onError?: (ws: WebSocket, error: Event) => void
  testId?: string
}

function createWebSocketTest(options: WebSocketTestOptions): Promise<void> {
  const {
    url,
    timeout = 15_000,
    onOpen,
    onMessage,
    onClose,
    onError,
    testId = '',
  } = options

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    let testCompleted = false
    let timeoutId: NodeJS.Timeout

    function completeTest(error?: Error) {
      if (testCompleted) {
        return
      }
      testCompleted = true
      clearTimeout(timeoutId)

      // Ensure WebSocket is closed
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }

      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    }

    timeoutId = setTimeout(() => {
      const state = ws.readyState === WebSocket.OPEN
        ? 'open'
        : ws.readyState === WebSocket.CONNECTING
          ? 'connecting'
          : ws.readyState === WebSocket.CLOSING
            ? 'closing'
            : 'closed'
      completeTest(new Error(`WebSocket test timeout${testId ? ` for ${testId}` : ''} (state: ${state})`))
    }, timeout)

    ws.addEventListener('open', async () => {
      if (onOpen) {
        try {
          await vi.waitFor(() => ws.readyState === WebSocket.OPEN)
          onOpen(ws)
        }
        catch (error) {
          completeTest(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })

    ws.addEventListener('message', (event) => {
      if (onMessage) {
        try {
          onMessage(ws, event)
        }
        catch (error) {
          completeTest(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })

    ws.addEventListener('close', (event) => {
      if (onClose) {
        try {
          const shouldComplete = onClose(ws, event)
          if (shouldComplete) {
            completeTest()
          }
          else {
            completeTest(new Error(`WebSocket test failed${testId ? ` for ${testId}` : ''} (close code: ${event.code})`))
          }
        }
        catch (error) {
          completeTest(error instanceof Error ? error : new Error(String(error)))
        }
      }
      else {
        completeTest()
      }
    })

    ws.addEventListener('error', (error) => {
      if (onError) {
        try {
          onError(ws, error)
        }
        catch (err) {
          completeTest(err instanceof Error ? err : new Error(String(err)))
        }
      }
      else {
        completeTest(new Error(`WebSocket error${testId ? ` for ${testId}` : ''}: ${error}`))
      }
    })
  })
}
