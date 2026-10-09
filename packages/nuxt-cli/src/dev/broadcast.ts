import { BroadcastChannel } from 'node:worker_threads'

import { debug } from '../utils/logger'

/** Listen on the channel called `name`, or return nothing where the runtime cannot open one. */
export function openBroadcast<T>(name: string, onMessage: (data: T) => void): BroadcastChannel | undefined {
  try {
    const channel = new BroadcastChannel(name)
    channel.unref()
    channel.onmessage = (event: { data: T }) => onMessage(event.data)
    return channel
  }
  catch (error) {
    debug(`Could not open the \`${name}\` channel:`, error)
  }
}
