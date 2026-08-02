import type { ArgDef } from 'citty'

import { readdirSync } from 'node:fs'
import http from 'node:http'
import process from 'node:process'
import { styleText } from 'node:util'

import { join, resolve } from 'pathe'

import { findDevServer, findNitroDevWorker, noDevServerMessage, resolveLockDir, toLoopback } from '../../utils/dev-server'
import { highlightJson } from '../../utils/json-highlight'
import { logger } from '../../utils/logger'
import { logNetworkError } from '../../utils/network'
import { getNuxtConfig } from '../../utils/nuxt-config'
import { resolveRootDir } from '../../utils/paths'

const TRAILING_SLASH_RE = /\/$/

export const taskArgs = {
  url: {
    type: 'string',
    description: 'URL of the Nuxt server to talk to (default: the running dev server)',
    valueHint: 'url',
  },
} as const satisfies Record<string, ArgDef>

interface ServerError {
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
  stack?: string | string[]
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** Where task requests are sent, and how they get there. */
export interface TaskServer {
  /** Origin for HTTP requests, and the label used when one fails. */
  base: string
  /** Socket to send the request over, for a Nitro dev worker. */
  socketPath?: string
}

export interface TaskResponse {
  ok: boolean
  status: number
  data: unknown
}

export interface TaskList {
  tasks?: Record<string, { description?: string }>
  scheduledTasks?: { cron: string, tasks: string[] }[] | false
}

/**
 * Resolve where the task routes live: an explicit `--url`, the dev server
 * recorded in the project's lock file, or the Nitro dev worker behind it.
 *
 * The worker is a fallback rather than the first choice because its address
 * comes from a file Nitro owns; the dev server's public URL is what this CLI
 * records itself.
 */
export async function resolveTaskServer(args: { url?: string, cwd?: string, rootDir?: string }): Promise<TaskServer> {
  if (args.url) {
    if (!URL.canParse(args.url)) {
      logger.error(`Invalid ${styleText('cyan', '--url')} value ${styleText('cyan', args.url)}.`)
      process.exit(1)
    }
    return { base: args.url.replace(TRAILING_SLASH_RE, '') }
  }

  const cwd = resolveRootDir(args)

  const buildDir = await resolveLockDir(cwd)

  const server = await findDevServer(cwd, buildDir)
  if (server) {
    return { base: server.url }
  }

  const worker = await findNitroDevWorker(cwd, buildDir)
  if (worker?.socketPath) {
    return { base: 'http://localhost', socketPath: worker.socketPath }
  }
  if (worker?.url) {
    return { base: toLoopback(worker.url) }
  }

  logger.error(noDevServerMessage('nuxt task'))
  process.exit(1)
}

export async function fetchTasks(server: TaskServer): Promise<TaskResponse> {
  return await request(server, '/_nitro/tasks')
}

/**
 * Ask the server to run a task.
 *
 * Nitro 2 exposes the dev task route for any method and reads the payload from
 * a `{ name, payload }` body; Nitro 3 also accepts that body, but earlier
 * prereleases registered the route for `GET` only and merged query parameters
 * into the payload. `POST` is tried first, falling back to a query-encoded
 * `GET` when the route rejects it.
 */
export async function runTask(server: TaskServer, name: string, payload: Record<string, unknown>): Promise<TaskResponse> {
  const path = `/_nitro/tasks/${name.split('/').map(encodeURIComponent).join('/')}`

  const posted = await request(server, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, payload }),
  })
  if (posted.ok || (posted.status !== 404 && posted.status !== 405)) {
    return posted
  }

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    query.set(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
  const search = query.size > 0 ? `?${query}` : ''
  const queried = await request(server, `${path}${search}`)

  return queried.ok ? queried : posted
}

/** Print the error a task route returned, with as much detail as it gave us. */
export function reportTaskError(response: TaskResponse): void {
  const error = (typeof response.data === 'object' && response.data ? response.data : {}) as ServerError
  const message = error.message || error.statusMessage || `Request failed with status ${response.status}`

  logger.error(message)

  if (error.data !== undefined) {
    process.stderr.write(`${format(error.data)}\n`)
  }

  // A 4xx describes the request (unknown or unimplemented task) and its stack is
  // all framework frames; a 5xx comes from the task itself, where they help.
  // Nitro repeats the message at the head of the stack, so only frames are kept.
  if (response.status >= 500) {
    const stack = (Array.isArray(error.stack) ? error.stack : (error.stack || '').split('\n'))
      .map(line => line.trim())
      .filter(line => line.startsWith('at '))
    if (stack.length > 0) {
      process.stderr.write(styleText('dim', `${stack.map(line => `  ${line}`).join('\n')}\n`))
    }
  }
}

/**
 * Advice for a server that answered but has no tasks to run.
 *
 * Nitro only scans the tasks directory when `nitro.experimental.tasks` is on,
 * so a project with the flag off is indistinguishable over HTTP from one that
 * has no tasks at all. Task files on disk are what tell the two apart.
 */
export async function emptyTaskListHint(cwd: string): Promise<string> {
  const enable = styleText('cyan', 'nitro: { experimental: { tasks: true } }')
  const dir = await resolveTasksDir(cwd)
  const label = styleText('cyan', `${dir}/`)

  return hasFiles(resolve(cwd, dir))
    ? `Found task files in ${label} but the server reports none. Add ${enable} to your Nuxt config and restart the dev server.`
    : `Add a task in ${label} and enable tasks with ${enable} in your Nuxt config.`
}

/** Advice for a server that does not expose the task routes at all. */
export function missingTaskRoutesHint(): string {
  return `Nitro only serves its task routes in development, so this needs a running ${styleText('cyan', 'nuxt dev')} server.`
}

/**
 * Explain a task the server does not have. Only the task list can tell a
 * mistyped name from a project whose tasks are not enabled, which is worth one
 * more request on a path that has already failed.
 */
export async function reportUnknownTask(server: TaskServer, cwd: string): Promise<void> {
  const response = await fetchTasks(server)
  if (!response.ok) {
    if (response.status === 404) {
      logger.info(missingTaskRoutesHint())
    }
    return
  }

  const names = Object.keys((response.data as TaskList | undefined)?.tasks || {}).sort()
  logger.info(names.length === 0
    ? await emptyTaskListHint(cwd)
    : `Available tasks: ${names.map(name => styleText('cyan', name)).join(', ')}`)
}

async function resolveTasksDir(cwd: string): Promise<string> {
  try {
    const config = await getNuxtConfig(cwd)
    return join(config.serverDir || join(config.srcDir || '.', 'server'), 'tasks')
  }
  catch {
    return 'server/tasks'
  }
}

function hasFiles(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0
  }
  catch {
    return false
  }
}

export function format(value: unknown): string {
  return typeof value === 'string' ? value : highlightJson(JSON.stringify(value, null, 2))
}

async function request(server: TaskServer, path: string, options: RequestOptions = {}): Promise<TaskResponse> {
  const headers = { accept: 'application/json', ...options.headers }

  try {
    return server.socketPath
      ? await socketRequest(server.socketPath, path, { ...options, headers })
      : await httpRequest(`${server.base}${path}`, { ...options, headers })
  }
  catch (error) {
    // A socket failure is never a network or proxy problem, so it gets a plain
    // message rather than the diagnostics `logNetworkError` would add.
    if (server.socketPath) {
      logger.error(`Could not reach the Nitro dev worker on ${styleText('cyan', describeSocket(server.socketPath))}: ${(error as Error).message}. Is the dev server still running?`)
      process.exit(1)
    }
    logNetworkError(error, { url: `${server.base}${path}` })
    process.exit(1)
  }
}

async function httpRequest(url: string, options: RequestOptions): Promise<TaskResponse> {
  const response = await fetch(url, options)
  return { ok: response.ok, status: response.status, data: parseBody(await response.text()) }
}

/**
 * Nitro's dev worker usually listens on a unix socket rather than a port, which
 * `fetch` cannot dial.
 */
function socketRequest(socketPath: string, path: string, options: RequestOptions): Promise<TaskResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: options.method || 'GET', headers: options.headers }, (res) => {
      res.setEncoding('utf-8')
      let body = ''
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('error', reject)
      res.on('end', () => {
        const status = res.statusCode || 0
        resolve({ ok: status >= 200 && status < 300, status, data: parseBody(body) })
      })
    })
    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function parseBody(text: string): unknown {
  if (!text) {
    return undefined
  }
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}

/** Abstract sockets start with a null byte, conventionally shown as `@`. */
function describeSocket(socketPath: string): string {
  return socketPath.replace(/\0/g, '@')
}
