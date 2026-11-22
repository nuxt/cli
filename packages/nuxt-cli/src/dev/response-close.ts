import type { ServerResponse } from 'node:http'

const callbacks = new WeakMap<ServerResponse, Array<() => void>>()

/**
 * Run `callback` when `res` closes, in the order callbacks were added.
 *
 * Every callback for a response shares one `close` listener, so the dev server
 * takes a single slot of the response's listener limit however many of its
 * parts are waiting.
 */
export function onResponseClose(res: ServerResponse, callback: () => void): void {
  const pending = callbacks.get(res)
  if (pending) {
    pending.push(callback)
    return
  }
  const added = [callback]
  callbacks.set(res, added)
  res.once('close', () => {
    for (const run of added) {
      run()
    }
  })
}
