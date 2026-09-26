import { Session } from 'node:inspector'
import { createServer } from 'node:net'
import process from 'node:process'
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'

import { closeInspector, inspectDevWorkers, parseInspectArgs, resolveProcessInspectOptions } from '../../src/dev/inspect'

describe('parseInspectArgs', () => {
  it('should return undefined when the inspector is not requested', () => {
    expect(parseInspectArgs([])).toBeUndefined()
    expect(parseInspectArgs(['--port', '3000', '--open'])).toBeUndefined()
  })

  it('should use node defaults for a bare `--inspect`', () => {
    expect(parseInspectArgs(['--inspect'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: false })
  })

  it('should parse a port only value', () => {
    expect(parseInspectArgs(['--inspect=3050'])).toStrictEqual({ host: '127.0.0.1', port: 3050, wait: false })
  })

  it('should parse a host and port value', () => {
    expect(parseInspectArgs(['--inspect=0.0.0.0:3050'])).toStrictEqual({ host: '0.0.0.0', port: 3050, wait: false })
  })

  it('should fall back to the default host when the host is empty', () => {
    expect(parseInspectArgs(['--inspect=:3050'])).toStrictEqual({ host: '127.0.0.1', port: 3050, wait: false })
  })

  it('should parse a host only value', () => {
    expect(parseInspectArgs(['--inspect=0.0.0.0'])).toStrictEqual({ host: '0.0.0.0', port: 9229, wait: false })
  })

  it('should parse bracketed ipv6 hosts', () => {
    expect(parseInspectArgs(['--inspect=[::]:3050'])).toStrictEqual({ host: '::', port: 3050, wait: false })
    expect(parseInspectArgs(['--inspect=[::1]'])).toStrictEqual({ host: '::1', port: 9229, wait: false })
  })

  it('should preserve `--inspect-brk` semantics', () => {
    expect(parseInspectArgs(['--inspect-brk'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: true })
    expect(parseInspectArgs(['--inspect-brk=0.0.0.0:3050'])).toStrictEqual({ host: '0.0.0.0', port: 3050, wait: true })
    expect(parseInspectArgs(['--inspect-wait'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: true })
  })

  it('should apply `--inspect-port` without enabling the inspector on its own', () => {
    expect(parseInspectArgs(['--inspect-port=3050'])).toBeUndefined()
    expect(parseInspectArgs(['--inspect', '--inspect-port=3050'])).toStrictEqual({ host: '127.0.0.1', port: 3050, wait: false })
    expect(parseInspectArgs(['--inspect-port=0.0.0.0:3050', '--inspect'])).toStrictEqual({ host: '0.0.0.0', port: 3050, wait: false })
  })

  it('should ignore unrelated arguments that mention inspect', () => {
    expect(parseInspectArgs(['--inspect-publish-uid=http'])).toBeUndefined()
    expect(parseInspectArgs(['--no-inspect'])).toBeUndefined()
    expect(parseInspectArgs(['./pages/--inspect.vue'])).toBeUndefined()
  })

  it('should let the last value win', () => {
    expect(parseInspectArgs(['--inspect=3050', '--inspect=9230'])).toStrictEqual({ host: '127.0.0.1', port: 9230, wait: false })
  })

  it('should ignore invalid ports', () => {
    expect(parseInspectArgs(['--inspect=99999'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: false })
  })
})

describe('resolveProcessInspectOptions', () => {
  it('should use the next port', () => {
    expect(resolveProcessInspectOptions({ host: '0.0.0.0', port: 9229, wait: true })).toStrictEqual({ host: '0.0.0.0', port: 9230, wait: true })
  })

  it('should keep a random port random', () => {
    expect(resolveProcessInspectOptions({ host: '127.0.0.1', port: 0, wait: false }).port).toBe(0)
  })
})

describe('inspectDevWorkers', () => {
  const getFreePort = () => new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

  const workerInspectorURL = (env: Record<string, string>) => {
    const worker = new Worker(
      `const { parentPort } = require('node:worker_threads')
      parentPort.on('message', () => parentPort.postMessage(require('node:inspector').url() ?? null))`,
      { eval: true, env: { ...process.env, ...env } },
    )
    const deadline = Date.now() + 2000
    return new Promise<string | null>((resolve) => {
      const poll = () => worker.postMessage('url')
      worker.on('message', (url) => {
        if (url || Date.now() > deadline) {
          worker.terminate().then(() => resolve(url))
        }
        else {
          setTimeout(poll, 50)
        }
      })
      poll()
    })
  }

  it('should open an inspector in nitro dev workers', async () => {
    const port = await getFreePort()
    inspectDevWorkers(Session, { host: '127.0.0.1', port, wait: false })
    try {
      expect(await workerInspectorURL({ NITRO_DEV_WORKER_ID: '1' })).toMatch(`ws://127.0.0.1:${port}/`)
      expect(await workerInspectorURL({})).toBeNull()
    }
    finally {
      await closeInspector()
    }
  })

  it('should wait for the port to be released', async () => {
    const port = await getFreePort()
    const blocker = createServer()
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', resolve))
    setTimeout(() => blocker.close(), 300)
    inspectDevWorkers(Session, { host: '127.0.0.1', port, wait: false })
    try {
      expect(await workerInspectorURL({ NITRO_DEV_WORKER_ID: '1' })).toMatch(`ws://127.0.0.1:${port}/`)
    }
    finally {
      await closeInspector()
    }
  })
})
