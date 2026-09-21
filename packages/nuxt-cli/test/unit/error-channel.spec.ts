import type { ErrorReport } from 'my-bad'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ReportContext } from '../../src/dev/error-channel'

import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { BroadcastChannel } from 'node:worker_threads'

import { normalize } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeErrorChannel, createCliReport, DEFAULT_ERROR_CHANNEL, ERROR_BROADCAST_CHANNEL, formatReportForTerminal, isDevErrorMessage, isErrorChannelRequest, openErrorBridge, publishCliProgress, renderErrorPage, resolveChannelPath, summariseReport, toBuildProgress, useErrorChannel } from '../../src/dev/error-channel'
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
    socket: { remoteAddress: '127.0.0.1' },
    on: () => {},
  } as unknown as IncomingMessage
}

function openRequest(headers: Record<string, string>, file = '/etc/passwd') {
  return Object.assign(Readable.from([JSON.stringify({ file })]), {
    url: `${DEFAULT_ERROR_CHANNEL}/open`,
    method: 'POST',
    headers: { 'host': 'localhost:3000', 'content-type': 'application/json', ...headers },
    rawHeaders: [],
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

/** A project of one file, with an editor that records what it was asked to open. */
async function createProject() {
  const dir = await mkdtemp(join(tmpdir(), 'nuxi-open-'))
  const file = join(dir, 'app.vue')
  const opened = join(dir, 'opened.txt')
  const editor = join(dir, 'editor.sh')
  await writeFile(file, '<template><div /></template>')
  await writeFile(editor, `#!/bin/sh\necho "$@" >> ${JSON.stringify(opened)}\n`)
  await chmod(editor, 0o755)
  vi.stubEnv('LAUNCH_EDITOR', editor)
  return { dir, file, opened }
}

/**
 * What the stub editor recorded. The shell creates the file when it opens the
 * append, so waiting for it to exist can hand back an empty read.
 */
async function waitForOpened(opened: string): Promise<string> {
  let recorded = ''
  await vi.waitUntil(async () => {
    recorded = existsSync(opened) ? await readFile(opened, 'utf8') : ''
    return recorded.length > 0
  })
  return recorded
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

  it('should only accept a log entry the drawer can show', () => {
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:log', entry: { level: 'info', text: 'ready', timestamp: 1 } })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:log', entry: { level: 'shout', text: 'ready' } })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:log', entry: { level: 'info', text: 42 } })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:log', entry: null })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:log' })).toBe(false)
  })

  it('should only accept a progress update the bar can draw', () => {
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform' } })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', percent: 100, message: 'Rebuilding' } })).toBe(true)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 7 } })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', percent: Number.NaN } })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', percent: '50' } })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', message: 3 } })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress', progress: null })).toBe(false)
    expect(isDevErrorMessage({ type: 'nuxt:dev:error:progress' })).toBe(false)
  })
})

const idleSnapshot = {
  status: 'ready' as const,
  phase: 'ready',
  message: 'Ready',
  index: 6,
  total: 6,
  progress: 1,
  elapsed: 0,
  phaseElapsed: 0,
  reload: false,
  serving: true,
  timings: [],
}

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

  it('should round the phase progress to a whole percentage', () => {
    expect(toBuildProgress(snapshot)).toEqual({ phase: 'bundle', percent: 67, message: 'Bundling app', source: 'cli' })
  })

  it('should leave the bar indeterminate once the load has failed', () => {
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

describe('createCliReport', () => {
  it('should render the source a config syntax error failed on', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nuxi-config-'))
    const file = join(dir, 'nuxt.config.ts')
    await writeFile(file, 'export default defineNuxtConfig({\n  a: 1\n  b: 2\n})\n')
    const report = await createCliReport(new Error(`ParseError: Unexpected token\n ${file}:3:2`), { cwd: dir })

    expect(report.kind).toBe('compile')
    expect(report.name).toBe('ParseError')
    expect(report.frames[0]?.file).toBe(normalize(file))
    expect(report.frames[0]?.snippet?.lines.join('\n')).toContain('b: 2')
  })
})

describe('renderErrorPage', () => {
  it('should render a page that subscribes to the channel it is served from', async () => {
    const report = await createCliReport(new Error('rendered'), { cwd: process.cwd() })

    const html = await renderErrorPage(report, { channel: DEFAULT_ERROR_CHANNEL })
    const state = JSON.parse(html.match(/<script type="application\/json">(?<state>.*?)<\/script>/s)?.groups?.state ?? '{}')

    expect(state).toMatchObject({ mode: 'page', channel: DEFAULT_ERROR_CHANNEL, environment: 'Build' })
    expect(state.report.message).toBe('rendered')
    expect(html).toMatch(/>Build</)
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

  it('should publish a forwarded report against the request it was raised for', async () => {
    createServer()
    const instance = await useErrorChannel()
    const setError = vi.spyOn(instance, 'setError')
    const reports: ErrorReport[] = []
    const close = openErrorBridge({ onReport: report => reports.push(report) })

    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    const requestReport = compileReport('/app/app.vue', 3, 1)
    const buildReport = compileReport('/app/pages/index.vue', 5, 2)
    app.postMessage({ type: 'nuxt:dev:error:report', report: requestReport, requestId: 4, request: 'GET /broken?x=1' })
    app.postMessage({ type: 'nuxt:dev:error:report', report: buildReport })
    app.close()

    await vi.waitUntil(() => reports.length === 2)
    close()
    expect(setError).toHaveBeenNthCalledWith(1, requestReport, '4', 'GET /broken?x=1')
    expect(setError).toHaveBeenNthCalledWith(2, buildReport, undefined, undefined)
  })

  it('should publish a log entry the app forwards, without telling the supervisor', async () => {
    createServer()
    const instance = await useErrorChannel()
    const log = vi.spyOn(instance, 'log')
    const reports: ErrorReport[] = []
    const cleared: Array<string | undefined> = []
    const close = openErrorBridge({ onReport: report => reports.push(report), onClear: id => cleared.push(id) })

    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    app.postMessage({ type: 'nuxt:dev:error:log', entry: { level: 'warn', text: 'slow route', timestamp: 5 } })
    app.postMessage({ type: 'nuxt:dev:error:log', entry: { level: 'nope', text: 'dropped' } })
    app.close()

    await vi.waitUntil(() => log.mock.calls.length === 1)
    close()
    expect(log).toHaveBeenCalledWith({ level: 'warn', text: 'slow route', timestamp: 5 })
    expect(reports).toHaveLength(0)
    expect(cleared).toHaveLength(0)
  })

  it('should publish a progress update the app forwards, without telling the supervisor', async () => {
    createServer()
    const instance = await useErrorChannel()
    const progress = vi.spyOn(instance, 'progress')
    const reports: ErrorReport[] = []
    const cleared: Array<string | undefined> = []
    const close = openErrorBridge({ onReport: report => reports.push(report), onClear: id => cleared.push(id) })

    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    app.postMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', message: 'Rebuilding' } })
    app.postMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', percent: 'done' } })
    app.close()

    await vi.waitUntil(() => progress.mock.calls.length === 1)
    close()
    expect(progress).toHaveBeenCalledWith({ phase: 'transform', message: 'Rebuilding', source: 'app' })
    expect(reports).toHaveLength(0)
    expect(cleared).toHaveLength(0)
  })

  it('should keep the CLI\'s own progress apart from what the app forwards', async () => {
    createServer()
    const instance = await useErrorChannel()
    const progress = vi.spyOn(instance, 'progress')
    const close = openErrorBridge()

    await publishCliProgress({ ...idleSnapshot, status: 'loading', progress: 0.5 })
    const app = new BroadcastChannel(ERROR_BROADCAST_CHANNEL)
    app.postMessage({ type: 'nuxt:dev:error:progress', progress: { phase: 'transform', percent: 90, source: 'vite' } })
    app.close()

    await vi.waitUntil(() => progress.mock.calls.length === 2)
    close()
    expect(progress.mock.calls.map(([update]) => update.source)).toEqual(['cli', 'vite'])
  })

  it.each([
    `${DEFAULT_ERROR_CHANNEL}/events?path=/`,
    `${DEFAULT_ERROR_CHANNEL}/history/abc`,
    `${DEFAULT_ERROR_CHANNEL}/open`,
  ])('should refuse %s to a peer on another machine', async (url) => {
    const server = createServer()
    const { res, statusOf, chunks } = createResponse()
    const remote = Object.assign(request(url), { socket: { remoteAddress: '192.168.0.31' } })

    await server.handler(remote, res)

    expect(statusOf()).toBe(403)
    expect(chunks.join('')).not.toContain('event: hello')
  })

  it('should keep a report away from a peer on another machine', async () => {
    const server = createServer()
    const report = await createCliReport(new Error('boom from a page'), { cwd: process.cwd() })
    const instance = await useErrorChannel()
    instance.setError(report)

    const { res, statusOf, chunks } = createResponse()
    const remote = Object.assign(request(`${DEFAULT_ERROR_CHANNEL}/history/${report.id}`), { socket: { remoteAddress: '192.168.0.31' } })
    await server.handler(remote, res)

    expect(statusOf()).toBe(403)
    expect(chunks.join('')).not.toContain('boom from a page')
  })

  it('should refuse a channel request with no peer address', async () => {
    const server = createServer()
    const { res, statusOf } = createResponse()
    const anonymous = request(`${DEFAULT_ERROR_CHANNEL}/history/abc`)
    delete (anonymous as { socket?: unknown }).socket

    await server.handler(anonymous, res)

    expect(statusOf()).toBe(403)
  })

  it('should refuse a channel request another site made', async () => {
    const server = createServer()
    const { res, statusOf } = createResponse()

    await server.handler(openRequest({ 'origin': 'https://evil.example', 'sec-fetch-site': 'cross-site' }), res)

    expect(statusOf()).toBe(403)
  })

  it('should refuse a channel request that did not come from the error page', async () => {
    const server = createServer()
    const { res, statusOf } = createResponse()

    await server.handler(openRequest({ 'origin': 'https://evil.example', 'content-type': 'text/plain' }), res)

    expect(statusOf()).toBe(403)
  })

  it.skipIf(process.platform === 'win32')('should only open files of the project it was pointed at', async () => {
    const { dir, file, opened } = await createProject()

    const instance = await useErrorChannel({ cwd: dir })
    await instance.handler(openRequest({}, '/etc/passwd'), createResponse().res)
    await instance.handler(openRequest({}, file), createResponse().res)

    const spawned = await waitForOpened(opened)
    expect(spawned).toContain(file)
    expect(spawned).not.toContain('passwd')
  })

  it.skipIf(process.platform === 'win32')('should refuse a path inside the project that names no file', async () => {
    const { dir, file, opened } = await createProject()
    const { res, statusOf } = createResponse()

    const instance = await useErrorChannel({ cwd: dir })
    await instance.handler(openRequest({}, join(dir, 'a&calc.exe')), res)

    expect(statusOf()).toBe(400)
    expect(existsSync(opened)).toBe(false)

    await instance.handler(openRequest({}, file), createResponse().res)
    await waitForOpened(opened)
  })

  it.skipIf(process.platform === 'win32')('should refuse a directory, and a symlink leaving the project', async () => {
    const { dir, opened } = await createProject()
    const outside = await mkdtemp(join(tmpdir(), 'nuxi-outside-'))
    const secret = join(outside, 'secret.txt')
    await writeFile(secret, 'not yours')
    await symlink(secret, join(dir, 'link.txt'))

    const instance = await useErrorChannel({ cwd: dir })
    const directory = createResponse()
    await instance.handler(openRequest({}, dir), directory.res)
    const escaping = createResponse()
    await instance.handler(openRequest({}, join(dir, 'link.txt')), escaping.res)

    expect(directory.statusOf()).toBe(400)
    expect(escaping.statusOf()).toBe(403)
    expect(existsSync(opened)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('should answer its own page served on a host the CLI allowed', async () => {
    const { dir, file } = await createProject()
    const { res, statusOf } = createResponse()

    const instance = await useErrorChannel({ cwd: dir })
    await instance.handler(openRequest({ 'host': '192.168.1.20:3000', 'origin': 'http://192.168.1.20:3000', 'sec-fetch-site': 'same-origin' }, file), res)

    expect(statusOf()).toBe(204)
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
    expect((await useErrorChannel()).current?.id).toBe(reports[1]!.report.id)
  })

  it('should write paths relative to the project it was given', async () => {
    const summary = await summariseReport(compileReport('/app/app.vue', 16, 6), {}, '/app')

    expect(summary.ansi).toContain('app.vue:16:6')
    expect(summary.ansi).not.toContain('/app/app.vue:16:6')
  })

  it('should answer an unknown channel path itself rather than passing it on', async () => {
    const server = createServer()
    const { res, statusOf } = createResponse()

    await server.handler(request(DEFAULT_ERROR_CHANNEL), res)

    expect(statusOf()).toBe(404)
  })
})
