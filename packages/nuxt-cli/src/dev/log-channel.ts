import { BroadcastChannel } from 'node:worker_threads'

export interface ServerLogEvent {
  level: number
  logType: string
  tag?: string
  message: string
  /** Whether the app produced this while serving a request. */
  origin: 'build' | 'runtime'
  /** The request this was emitted for. */
  request?: string
  requestId?: number
}

/**
 * Where `runtime/dev-request-context.mjs` sends the app's logs.
 *
 * Nitro runs the app in a worker thread, so the two sides share no object at
 * all: not `globalThis`, not `process`, and no `AsyncLocalStorage`. A
 * `BroadcastChannel` crosses that boundary without borrowing the channel Nitro
 * uses to talk to its own worker.
 */
export const DEV_LOG_CHANNEL = 'nuxt:dev:log'

/** Receive the app's logs until the returned function is called. */
export function openDevLogChannel(sink: (log: ServerLogEvent) => void): () => void {
  const channel = new BroadcastChannel(DEV_LOG_CHANNEL)
  channel.unref()
  channel.onmessage = (event: { data: ServerLogEvent }) => {
    sink(event.data)
  }
  return () => channel.close()
}
