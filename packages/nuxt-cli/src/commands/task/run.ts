import process from 'node:process'
import { styleText } from 'node:util'

import { defineCommand } from 'citty'

import { logger } from '../../utils/logger'
import { rootDirArgs } from '../_shared'
import { format, reportTaskError, resolveTaskServer, runTask, taskArgs } from './_utils'

const PAYLOAD_PREFIX = 'payload.'

export default defineCommand({
  meta: {
    name: 'run',
    description: 'Run a task on a Nuxt server and print its result',
  },
  args: {
    // `name` has to precede the `dir` positional supplied by `rootDirArgs`
    name: {
      type: 'positional',
      description: 'Name of the task to run',
      valueHint: 'name',
    },
    ...rootDirArgs,
    ...taskArgs,
    payload: {
      type: 'string',
      description: 'Task payload, either as a JSON object or as `--payload.key=value` pairs',
      valueHint: 'json',
    },
  },
  async run(ctx) {
    const name = ctx.args.name
    if (!name) {
      logger.error(`Missing task name. Try ${styleText('cyan', 'nuxt task list')} to see what is available.`)
      process.exit(1)
    }

    const payload = resolvePayload(ctx.args)
    const server = await resolveTaskServer(ctx.args)
    const response = await runTask(server, name, payload)

    if (!response.ok) {
      reportTaskError(response)
      process.exit(1)
    }

    const result = unwrapResult(response.data)
    if (result !== undefined) {
      process.stdout.write(`${format(result)}\n`)
    }
  },
})

/**
 * Nitro answers a task run with `{ result }`. Printing the result on its own is
 * what `nitro task run` shows and what a caller can pipe into `jq`, so the
 * envelope is dropped when that is all the response holds.
 */
function unwrapResult(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data
  }
  const keys = Object.keys(data)
  return keys.length === 1 && keys[0] === 'result' ? (data as { result: unknown }).result : data
}

function resolvePayload(args: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  if (typeof args.payload === 'string' && args.payload.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(args.payload)
    }
    catch {
      logger.error(`Could not parse ${styleText('cyan', '--payload')} as JSON. Pass a JSON object, or use ${styleText('cyan', '--payload.key=value')}.`)
      process.exit(1)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.error(`${styleText('cyan', '--payload')} must be a JSON object.`)
      process.exit(1)
    }
    Object.assign(payload, parsed)
  }

  for (const [key, value] of Object.entries(args)) {
    if (key.startsWith(PAYLOAD_PREFIX)) {
      assign(payload, key.slice(PAYLOAD_PREFIX.length).split('.'), value)
    }
  }

  return payload
}

function assign(target: Record<string, unknown>, path: string[], value: unknown): void {
  const key = path[0]!
  if (path.length === 1) {
    target[key] = value
    return
  }
  const existing = target[key]
  const child = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {}
  target[key] = child
  assign(child, path.slice(1), value)
}
