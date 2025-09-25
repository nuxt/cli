import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPort, waitForPort } from 'get-port-please'
import { isCI, isLinux, isWindows } from 'std-env'
import { WebSocket } from 'undici'
import { afterAll, describe, expect, it, vi } from 'vitest'

const playgroundDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxiPath = join(fileURLToPath(new URL('../..', import.meta.url)), 'bin/nuxi.mjs')

const hasBun = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0
const hasDeno = spawnSync('deno', ['--version'], { stdio: 'ignore' }).status === 0

describe.sequential.each(['bun', 'node', 'deno'] as const)('dev server (%s)', (runtime) => {
  let server: DevServerInstance

  if (runtime === 'bun' && !hasBun && !isCI) {
    console.warn('Not testing locally with bun as it is not installed.')
    it.skip('should pass with bun')
    return
  }

  if (runtime === 'deno' && !hasDeno && !isCI) {
    console.warn('Not testing locally with deno as it is not installed.')
    it.skip('should pass with deno')
    return
  }

  const cwd = resolve(playgroundDir, `../playground-${runtime}`)

  afterAll(async () => {
    await server?.close()
    await rm(cwd, { recursive: true, force: true }).catch(() => null)
  })

  const isWindowsNonDeno = isWindows && runtime === 'deno'
  const assertNonDeno = isWindowsNonDeno ? it.fails : it
  assertNonDeno('should start dev server', { timeout: isCI ? 60_000 : 30_000 }, async () => {
    rmSync(cwd, { recursive: true, force: true })
    cpSync(playgroundDir, cwd, {
      recursive: true,
      filter: src => !src.includes('.nuxt') && !src.includes('.output'),
    })
    server = await startDevServer({ cwd, runtime })
  })

  if (isWindowsNonDeno) {
    it.todo('should run rest of tests on windows')
    return
  }

  const assertNonWindowsBun = runtime === 'bun' && isWindows ? it.fails : it
  assertNonWindowsBun('should serve the main page', async () => {
    const response = await fetch(server.url)
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain('Welcome to the Nuxt CLI playground')
    expect(html).toContain('<!DOCTYPE html>')
  })

  assertNonWindowsBun('should serve static assets', async () => {
    const response = await fetch(`${server.url}/favicon.ico`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/')
  })

  assertNonWindowsBun('should handle API routes', async () => {
    const response = await fetch(`${server.url}/api/hello`)
    expect(response.status).toBe(200)
  })

  assertNonWindowsBun('should handle POST requests', async () => {
    const response = await fetch(`${server.url}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' }),
    })

    expect(response.status).toBe(200)
  })

  assertNonWindowsBun('should preserve request headers', async () => {
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

  assertNonWindowsBun('should handle concurrent requests', async () => {
    const requests = Array.from({ length: 5 }, () => fetch(server.url))
    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Welcome to the Nuxt CLI playground')
    }
  })

  assertNonWindowsBun('should handle large request payloads', async () => {
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

  assertNonWindowsBun('should handle different HTTP methods', async () => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE']

    for (const method of methods) {
      const response = await fetch(`${server.url}/api/hello`, { method })
      expect(response.status).toBe(200)

      const result = await response.json()
      expect(result.method).toBe(method)
    }
  })

  // TODO: fix websockets in bun + deno
  const assertNonLinux = runtime === 'bun' || (runtime === 'deno' && !isLinux) ? it.fails : it
  assertNonLinux('should establish websocket connection and handle ping/pong', async () => {
    const wsUrl = `${server.url.replace('http', 'ws')}/_ws`

    // Create a promise that resolves when the websocket test is complete
    const wsTest = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)

      let isConnected = false
      let receivedPong = false

      const timeout = setTimeout(() => {
        if (!isConnected) {
          reject(new Error('WebSocket connection timeout'))
        }
        else if (!receivedPong) {
          reject(new Error('Did not receive pong response'))
        }
        ws.close()
      }, 20_000)

      ws.addEventListener('open', () => {
        isConnected = true
        // Send ping message to test echo functionality
        ws.send('ping test message')
      })

      ws.addEventListener('message', (event) => {
        const message = event.data.toString()
        if (message === 'pong') {
          receivedPong = true
          clearTimeout(timeout)
          ws.close()
          resolve()
        }
      })

      ws.addEventListener('error', (error) => {
        clearTimeout(timeout)
        reject(new Error(`WebSocket error: ${error}`))
      })

      ws.addEventListener('close', () => {
        if (isConnected && receivedPong) {
          resolve()
        }
      })
    })

    await wsTest
  }, 20_000)

  // TODO: fix websockets in bun + deno
  assertNonLinux('should handle multiple concurrent websocket connections', async () => {
    const wsUrl = `${server.url.replace('http', 'ws')}/_ws`
    const connectionCount = 3

    const connectionPromises = Array.from({ length: connectionCount }, (_, index) => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl)

        const timeout = setTimeout(() => {
          reject(new Error(`WebSocket ${index} connection timeout`))
          ws.close()
        }, 5000)

        ws.addEventListener('open', () => {
          ws.send(`ping from connection ${index}`)
        })

        ws.addEventListener('message', (event) => {
          const message = event.data.toString()
          if (message === 'pong') {
            clearTimeout(timeout)
            ws.close()
            resolve()
          }
        })

        ws.addEventListener('error', (error) => {
          clearTimeout(timeout)
          reject(new Error(`WebSocket ${index} error: ${error}`))
        })
      })
    })

    await Promise.all(connectionPromises)
  }, 15000)

  // TODO: fix websockets in bun + deno
  const assertNonNode = runtime === 'bun' || runtime === 'deno' ? it.fails : it
  assertNonNode('should handle websocket connection close gracefully', async () => {
    const wsUrl = `${server.url.replace('http', 'ws')}/_ws`

    const wsTest = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)

      let isConnected = false

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket close test timeout'))
      }, 5000)

      ws.addEventListener('open', () => {
        isConnected = true
        // Immediately close the connection to test graceful handling
        ws.close(1000, 'Test close')
      })

      ws.addEventListener('close', (event) => {
        clearTimeout(timeout)
        try {
          expect(isConnected).toBe(true)
          expect(event.code).toBe(1000)
          expect(event.reason).toBe('Test close')
          resolve()
        }
        catch (error) {
          reject(error)
        }
      })

      ws.addEventListener('error', (error) => {
        clearTimeout(timeout)
        reject(new Error(`WebSocket close test error: ${error}`))
      })
    })

    await wsTest
  }, 10_000)
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
