import type { CommandDef } from 'citty'
import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'

import { runCommand } from 'citty'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import list from '../../../src/commands/task/list'
import run from '../../../src/commands/task/run'
import { logger } from '../../../src/utils/logger'

interface ReceivedRequest {
  method: string
  url: string
  body: string
}

const requests: ReceivedRequest[] = []

/** Set to `true` to emulate a Nitro version that only accepts `GET`. */
let getOnly = false
let envelope: unknown = { result: { ok: true } }
/** Set to `false` to emulate a server with no dev task routes at all. */
let tasksRoute = true
let taskList: unknown = {
  tasks: { 'db:migrate': { description: 'Migrate the database' }, 'db:seed': {} },
  scheduledTasks: [{ cron: '0 * * * *', tasks: ['db:seed'] }],
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const url = req.url!
  const request = { method: req.method!, url, body: Buffer.concat(chunks).toString('utf-8') }
  requests.push(request)

  res.setHeader('content-type', 'application/json')

  if (!tasksRoute) {
    res.statusCode = 404
    res.end(JSON.stringify({ statusCode: 404, message: `Page not found: ${url}` }))
    return
  }

  if (url === '/_nitro/tasks') {
    res.end(JSON.stringify(taskList))
    return
  }

  if (url.startsWith('/_nitro/tasks/unknown')) {
    res.statusCode = 404
    res.end(JSON.stringify({ statusCode: 404, message: 'Task `unknown` is not available!' }))
    return
  }

  if (getOnly && req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ statusCode: 405, message: 'Method not allowed' }))
    return
  }

  res.end(JSON.stringify(envelope))
})

let origin: string
let cwd: string
let stdout: string

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(async () => {
  requests.length = 0
  getOnly = false
  tasksRoute = true
  taskList = {
    tasks: { 'db:migrate': { description: 'Migrate the database' }, 'db:seed': {} },
    scheduledTasks: [{ cron: '0 * * * *', tasks: ['db:seed'] }],
  }
  envelope = { result: { ok: true } }
  stdout = ''
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-task-test-'))
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

async function writeBuildInfo(socketPath: string) {
  await mkdir(join(cwd, '.nuxt'), { recursive: true })
  await writeFile(join(cwd, '.nuxt', 'nitro.json'), JSON.stringify({
    dev: { pid: 424242, workerAddress: { socketPath } },
  }))
  vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
}

async function writeLock(url: string) {
  await mkdir(join(cwd, '.nuxt'), { recursive: true })
  await writeFile(join(cwd, '.nuxt', 'nuxt.lock'), JSON.stringify({
    pid: 424242,
    command: 'dev',
    cwd,
    url,
    startedAt: Date.now(),
  }))
  vi.spyOn(process, 'kill').mockImplementation(() => true as unknown as true)
}

/** Resolves with the exit code the command asked for, or `0` if it returned. */
async function runTaskCommand(command: CommandDef<any>, args: string[]): Promise<number> {
  let code = 0
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0
    throw new Error(`exit:${code}`)
  }) as never)

  try {
    await runCommand(command, { rawArgs: args })
  }
  catch (error) {
    if (!(error as Error).message.startsWith('exit:')) {
      throw error
    }
  }
  return code
}

describe('task list', () => {
  it('lists tasks with their descriptions', async () => {
    const code = await runTaskCommand(list, ['--url', origin])

    expect(code).toBe(0)
    expect(stdout).toContain('db:migrate')
    expect(stdout).toContain('Migrate the database')
    expect(stdout).toContain('0 * * * *')
  })

  it('prints machine readable output with `--json`', async () => {
    const code = await runTaskCommand(list, ['--url', origin, '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      tasks: [
        { name: 'db:migrate', description: 'Migrate the database' },
        { name: 'db:seed', description: null },
      ],
      scheduledTasks: [{ cron: '0 * * * *', tasks: ['db:seed'] }],
    })
  })

  it('prints an empty payload with `--json` when the server exposes no tasks', async () => {
    taskList = { tasks: {} }
    const code = await runTaskCommand(list, ['--url', origin, `--cwd=${cwd}`, '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ tasks: [], scheduledTasks: [] })
  })

  it('finds the dev server from the lock file', async () => {
    await writeLock(origin)
    const code = await runTaskCommand(list, [`--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(requests[0]?.url).toBe('/_nitro/tasks')
  })

  it('exits with 1 when no dev server is running', async () => {
    const code = await runTaskCommand(list, [`--cwd=${cwd}`])

    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('explains how to enable tasks when the server reports none', async () => {
    taskList = { tasks: {} }
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const code = await runTaskCommand(list, ['--url', origin, `--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('experimental: { tasks: true }'))
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Add a task in'))
  })

  it('points at the flag rather than the directory when task files exist', async () => {
    taskList = { tasks: {} }
    await mkdir(join(cwd, 'server', 'tasks'), { recursive: true })
    await writeFile(join(cwd, 'server', 'tasks', 'hello.ts'), 'export default defineTask({})')
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const code = await runTaskCommand(list, ['--url', origin, `--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Found task files in'))
    expect(info).toHaveBeenCalledWith(expect.stringContaining('server/tasks/'))
  })

  it('looks for tasks under a configured `serverDir`', async () => {
    taskList = { tasks: {} }
    await writeFile(join(cwd, 'nuxt.config.mjs'), 'export default { serverDir: "api" }')
    await mkdir(join(cwd, 'api', 'tasks'), { recursive: true })
    await writeFile(join(cwd, 'api', 'tasks', 'hello.ts'), 'export default defineTask({})')
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const code = await runTaskCommand(list, ['--url', origin, `--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('api/tasks/'))
  })

  it('explains that task routes only exist in development', async () => {
    tasksRoute = false
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const code = await runTaskCommand(list, ['--url', origin, `--cwd=${cwd}`])

    expect(code).toBe(1)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('only serves its task routes in development'))
  })
})

describe('task over the Nitro dev worker socket', () => {
  const socketServer = createServer(async (req, res) => {
    requests.push({ method: req.method!, url: req.url!, body: '' })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ tasks: { 'db:seed': { description: 'Seed' } } }))
  })

  let socketPath: string

  beforeAll(async () => {
    socketPath = join(await mkdtemp(join(tmpdir(), 'nuxt-task-socket-')), 'worker.sock')
    await new Promise<void>(resolve => socketServer.listen(socketPath, resolve))
  })

  afterAll(async () => {
    await new Promise<void>(resolve => socketServer.close(() => resolve()))
  })

  // Unix sockets are not available on Windows.
  it.skipIf(process.platform === 'win32')('falls back to the worker when no lock records a dev server', async () => {
    await writeBuildInfo(socketPath)
    const code = await runTaskCommand(list, [`--cwd=${cwd}`])

    expect(code).toBe(0)
    expect(requests[0]?.url).toBe('/_nitro/tasks')
    expect(stdout).toContain('db:seed')
  })

  it.skipIf(process.platform === 'win32')('reports a worker that is no longer listening', async () => {
    await writeBuildInfo(join(cwd, 'gone.sock'))
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const code = await runTaskCommand(list, [`--cwd=${cwd}`])

    expect(code).toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('gone.sock'))
  })
})

describe('task run', () => {
  it('posts the payload and prints the result', async () => {
    const code = await runTaskCommand(run, ['db:seed', '--url', origin, '--payload.count=3', '--payload.nested.flag=yes'])

    expect(code).toBe(0)
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/_nitro/tasks/db%3Aseed' })
    expect(JSON.parse(requests[0]!.body)).toEqual({
      name: 'db:seed',
      payload: { count: '3', nested: { flag: 'yes' } },
    })
    expect(stripVTControlCharacters(stdout)).toBe('{\n  "ok": true\n}\n')
  })

  it('prints a response that is not a bare result envelope as it came', async () => {
    envelope = { result: { ok: true }, duration: 12 }
    const code = await runTaskCommand(run, ['db:seed', '--url', origin])

    expect(code).toBe(0)
    expect(JSON.parse(stripVTControlCharacters(stdout))).toEqual({ result: { ok: true }, duration: 12 })
  })

  it('merges a JSON payload with dotted arguments', async () => {
    const code = await runTaskCommand(run, ['db:seed', '--url', origin, '--payload', '{"a":1}', '--payload.b=2'])

    expect(code).toBe(0)
    expect(JSON.parse(requests[0]!.body).payload).toEqual({ a: 1, b: '2' })
  })

  it('rejects an unparseable payload', async () => {
    const code = await runTaskCommand(run, ['db:seed', '--url', origin, '--payload', 'nope'])

    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('falls back to a query-encoded GET when POST is not allowed', async () => {
    getOnly = true
    const code = await runTaskCommand(run, ['db:seed', '--url', origin, '--payload.count=3'])

    expect(code).toBe(0)
    expect(requests.map(request => request.method)).toEqual(['POST', 'GET'])
    expect(requests[1]?.url).toBe('/_nitro/tasks/db%3Aseed?count=3')
  })

  it('exits non-zero and reports the server error', async () => {
    const code = await runTaskCommand(run, ['unknown', '--url', origin])

    expect(code).toBe(1)
  })

  it('lists what is available when the task name is unknown', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const code = await runTaskCommand(run, ['unknown', '--url', origin, `--cwd=${cwd}`])

    expect(code).toBe(1)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('db:migrate'))
  })

  it('explains how to enable tasks when the server has none at all', async () => {
    taskList = { tasks: {} }
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const code = await runTaskCommand(run, ['unknown', '--url', origin, `--cwd=${cwd}`])

    expect(code).toBe(1)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('experimental: { tasks: true }'))
  })
})
