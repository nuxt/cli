import type { ErrorReport } from 'my-bad'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ReportContext } from '../../src/dev/error-channel'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { BroadcastChannel } from 'node:worker_threads'

import { normalize } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeErrorChannel, createCliReport, DEFAULT_ERROR_CHANNEL, ERROR_BROADCAST_CHANNEL, formatReportForTerminal, isDevErrorMessage, isErrorChannelRequest, openErrorBridge, renderErrorPage, resolveChannelPath, summariseReport, toBuildProgress, toCompileInput, useErrorChannel } from '../../src/dev/error-channel'
import { NuxtDevServer } from '../../src/dev/utils'

function createResponse() {
  const chunks: string[] = []
  const listeners = new Map<string, () => void>()
  const res = {
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value
    },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status
      for (const [key, value] of Object.entries(headers ?? {})) {
        this.headers[key.toLowerCase()] = value
      }
      return this
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    end(chunk?: string) {
      if (chunk) {
        chunks.push(chunk)
      }
      this.writableEnded = true
      return this
    },
    once(event: string, listener: () => void) {
      listeners.set(event, listener)
      return this
    },
  }
  return { res: res as unknown as ServerResponse, headers: res.headers, chunks, statusOf: () => res.statusCode }
}

function request(url: string) {
  return {
    url,
    method: 'GET',
    headers: { accept: 'text/html' },
    rawHeaders: [],
    on: () => {},
  } as unknown as IncomingMessage
}

function createServer() {
  return new NuxtDevServer({ cwd: process.cwd(), dotenv: {}, overrides: {} })
}

afterEach(async () => {
  vi.unstubAllEnvs()
  delete process.env.NUXT_DEV_ERROR_CHANNEL
  await closeErrorChannel()
})

describe('resolveChannelPath', () => {
  it('should refuse a path that would swallow the app\'s own routes', () => {
    expect(resolveChannelPath('/__nuxt_dev__/error')).toBe('/__nuxt_dev__/error')
    expect(resolveChannelPath('/__nuxt_dev__/error/')).toBe('/__nuxt_dev__/error')
    expect(resolveChannelPath('/')).toBeUndefined()
    expect(resolveChannelPath('__nuxt_dev__/error')).toBeUndefined()
    expect(resolveChannelPath(42)).toBeUndefined()
  })
})

describe('isErrorChannelRequest', () => {
  it('should match the channel and nothing else', () => {
    expect(isErrorChannelRequest(DEFAULT_ERROR_CHANNEL, DEFAULT_ERROR_CHANNEL)).toBe(true)
    expect(isErrorChannelRequest(`${DEFAULT_ERROR_CHANNEL}/events`, DEFAULT_ERROR_CHANNEL)).toBe(true)
    expect(isErrorChannelRequest(`${DEFAULT_ERROR_CHANNEL}s`, DEFAULT_ERROR_CHANNEL)).toBe(false)
    expect(isErrorChannelRequest('/__nuxt_dev__/progress', DEFAULT_ERROR_CHANNEL)).toBe(false)
  })
})

describe('the forwarding protocol', () => {
  it('should only accept the messages the app forwards', () => {
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:report', report: {} })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:clear' })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:warning', report: {} })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:internal:dev:log' })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:sync' })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:report', report: {}, request: 'GET /ok' })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:report', report: {}, request: 7 })).toBe(false)
    expect(isDevErrorMessage(undefined)).toBe(false)
  })
})

describe('toBuildProgress', () => {
  const snapshot = {
    status: 'loading' as const,
    phase: 'bundle',
    message: 'Bundling app',
    index: 4,
    total: 6,
    progress: 0.666,
    elapsed: 0,
    phaseElapsed: 0,
    reload: false,
    serving: false,
    timings: [],
  }

  it('should leave the bar indeterminate once the load has failed', () => {
    expect(toBuildProgress(snapshot)).toEqual({ phase: 'bundle', percent: 67, message: 'Bundling app' })
    expect(toBuildProgress({ ...snapshot, status: 'error' }).percent).toBeUndefined()
  })
})

function compileReport(file: string, line: number, column: number) {
  return {
    id: `${file}:${line}`,
    kind: 'error',
    name: 'Error',
    message: 'failed to load',
    frames: [],
    sections: [],
    timestamp: Date.now(),
    causes: [{
      id: 'compile',
      kind: 'compile',
      name: 'CompileError',
      message: 'unexpected token',
      frames: [{ file, line, column, type: 'app' }],
      sections: [],
      causes: [],
      timestamp: Date.now(),
    }],
  } as unknown as ErrorReport
}

describe('toCompileInput', () => {
  it('should lift the position a syntax error quotes in its message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nuxi-config-'))
    const file = join(dir, 'nuxt.config.ts')
    await writeFile(file, 'export default defineNuxtConfig({\n  a: 1\n  b: 2\n})\n')
    const error = new Error(`ParseError: Unexpected token, expected ","  \n ${file}:3:2`)

    const input = toCompileInput(error)

    // Handed on with forward slashes, which is the only form a report reads.
    expect(input).toMatchObject({
      name: 'ParseError',
      message: 'Unexpected token, expected ","',
      id: normalize(file),
      loc: { file: normalize(file), line: 3, column: 2 },
    })
  })

  it('should render the source the error failed on', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nuxi-config-'))
    const file = join(dir, 'nuxt.config.ts')
    await writeFile(file, 'export default defineNuxtConfig({\n  a: 1\n  b: 2\n})\n')
    const report = await createCliReport(new Error(`ParseError: Unexpected token\n ${file}:3:2`), { cwd: dir })

    expect(report.kind).toBe('compile')
    expect(report.frames[0]?.snippet?.lines.join('\n')).toContain('b: 2')
  })

  it('should leave an error whose position it cannot trust alone', () => {
    expect(toCompileInput(new Error('boom'))).toBeUndefined()
    expect(toCompileInput(new Error('ParseError: boom\n /nowhere/nuxt.config.ts:3:2'))).toBeUndefined()
    expect(toCompileInput('not an error')).toBeUndefined()
  })
})

describe('renderErrorPage', () => {
  it('should render a page that subscribes to the channel it is served from', async () => {
    const report = await createCliReport(new Error('rendered'), { cwd: process.cwd() })

    const html = await renderErrorPage(report, { channel: DEFAULT_ERROR_CHANNEL })

    expect(html).toContain('rendered')
    expect(html).toContain(DEFAULT_ERROR_CHANNEL)
  })
})

describe('formatReportForTerminal', () => {
  const report = { id: 'a', name: 'SyntaxError', message: 'Illegal \'/\' in tags.', location: 'app/app.vue:16:6', ansi: 'the frame' }

  it('should head a report with the request that hit it', () => {
    expect(formatReportForTerminal({ ...report, request: 'GET /ok?a=1' })).toBe('[request error] [GET] /ok?a=1\n\n  the frame')
  })

  it('should print a report raised outside a request as it is', () => {
    expect(formatReportForTerminal(report)).toBe('the frame')
  })
})

describe('summariseReport', () => {
  it('should carry the rendering and the topmost frame of the project', async () => {
    const error = new Error('summarise me')
    const report = await createCliReport(error, { cwd: process.cwd() })
    const summary = await summariseReport(report, { requestId: 7 })

    expect(summary).toMatchObject({ id: report.id, name: 'Error', message: 'summarise me', requestId: 7 })
    expect(summary.file).toContain('error-channel.spec.ts')
    expect(summary.location).toMatch(/^\.\/packages\/nuxt-cli\/test\/unit\/error-channel\.spec\.ts:\d+:\d+$/)
    expect(summary.ansi).toContain('summarise me')
  })
})

describe('the CLI-owned error channel', () => {
  it('should answer the channel stream before nuxt exists', async () => {
    const server = createServer()
    const { res, chunks, headers } = createResponse()

    await Promise.race([
      server.handler(request(`${DEFAULT_ERROR_CHANNEL}/events`), res),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('request hung')), 1000)),
    ])

    expect(headers['content-type']).toBe('text/event-stream')
    expect(chunks.join('')).toContain('event: hello')
  })

  it('should announce the path it mounted to the app', () => {
    createServer()

    expect(process.env.NUXT_DEV_ERROR_CHANNEL).toBe(DEFAULT_ERROR_CHANNEL)
  })

  it('should leave the channel to the app when it runs outside this process', async () => {
    vi.stubEnv('NITRO_DEV_RUNNER', 'node-process')
    const server = createServer()
    const { res, statusOf } = createResponse()

    await server.handler(request(`${DEFAULT_ERROR_CHANNEL}/events`), res)

    expect(process.env.NUXT_DEV_ERROR_CHANNEL).toBeUndefined()
    expect(statusOf()).toBe(503)
  })

  it('should publish and serve a report the app forwards', async () => {
    const server = createServer()
    const report = await createCliReport(new Error('forwarded from the app'), { cwd: process.cwd() })
    const reports: Array<{ report: ErrorReport, context: ReportContext }> = []
    const close = openErrorBridge({ onReport: (report, context) => reports.push({ report, context }) })

    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    app.postMessage({ type: 'nuxt:dev:error:report', report, requestId: 3 })
    app.close()

    await vi.waitUntil(() => reports.length === 1)
    close()
    expect(reports[0]!.report.message).toBe('forwarded from the app')
    expect(reports[0]!.context.requestId).toBe(3)

    const { res, chunks } = createResponse()
    await server.handler(request(`${DEFAULT_ERROR_CHANNEL}/history/${report.id}`), res)
    expect(chunks.join('')).toContain('forwarded from the app')
  })

  it('should ask whoever is already reporting to post it again', async () => {
    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    const synced = new Promise<unknown>((resolve) => {
      app.onmessage = (event: { data: unknown }) => resolve((event.data as { type?: string }).type)
    })

    const close = openErrorBridge()

    expect(await synced).toBe('nuxt:dev:error:sync')
    close()
    app.close()
  })

  it('should show the report of every failing request, in the order they arrive', async () => {
    const reports: Array<{ report: ErrorReport, context: ReportContext }> = []
    const close = openErrorBridge({ onReport: (report, context) => reports.push({ report, context }) })

    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    app.postMessage({ type: 'nuxt:dev:error:report', report: compileReport('/app/app.vue', 3, 1) })
    app.postMessage({ type: 'nuxt:dev:error:report', report: compileReport('/app/app.vue', 3, 1), requestId: 2, request: 'GET /ok' })
    app.close()

    await vi.waitUntil(() => reports.length === 2)
    close()
    expect(reports[1]!.context.request).toBe('GET /ok')
    // The page is served with the incoming report, so the channel shows the same one.
    expect((await useErrorChannel()).current?.id).toBe(reports[1]!.report.id)
  })

  it('should write paths relative to the project it was given', async () => {
    const summary = await summariseReport(compileReport('/app/app.vue', 16, 6), {}, '/app')

    expect(summary.ansi).toContain('app.vue:16:6')
    expect(summary.ansi).not.toContain('/app/app.vue:16:6')
  })

  it('should not echo a cause that only repeats its parent', async () => {
    const wrapped = compileReport('/app/app.vue', 3, 1)
    wrapped.causes = [{ ...wrapped.causes[0]!, message: wrapped.message, name: 'HTTPError' }]
    const summary = await summariseReport(wrapped)

    expect(summary.ansi).not.toContain('HTTPError')
  })

  it('should answer an unknown channel path itself rather than passing it on', async () => {
    const server = createServer()
    const { res, statusOf } = createResponse()

    await server.handler(request(DEFAULT_ERROR_CHANNEL), res)

    expect(statusOf()).toBe(404)
  })
})
