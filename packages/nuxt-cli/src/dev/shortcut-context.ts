import type { Listener } from './listen'

export interface ShortcutContext {
  /** The bound server, once there is one. */
  listener?: Listener
  close: () => Promise<void>
  restart?: () => void | Promise<void>
  /** Remove the caches that make the next start cold, naming what went. */
  clearCaches?: () => Promise<string[]>
  onReady: (callback: (address: string) => void) => void
}

/** What a started dev server contributes to a {@link ShortcutContext}. */
interface ShortcutServer {
  listener: Listener
  close: () => Promise<void>
  restart?: () => void | Promise<void>
  onReady: (callback: (address: string) => void) => void
}

export interface DeferredShortcutContext {
  context: ShortcutContext
  attach: (server: ShortcutServer) => void
}

/**
 * A context for shortcuts bound before the dev server exists, so the keyboard
 * answers from the first frame. {@link ShortcutContext.listener} is undefined
 * until {@link DeferredShortcutContext.attach}, and ready callbacks registered
 * before then are forwarded to the server when it arrives.
 */
export function deferShortcutContext(options: Pick<ShortcutContext, 'clearCaches'> = {}): DeferredShortcutContext {
  let server: ShortcutServer | undefined
  let closing: Promise<void> | undefined
  const pendingReady: Array<(address: string) => void> = []

  return {
    context: {
      clearCaches: options.clearCaches,
      get listener() {
        return server?.listener
      },
      get restart() {
        return server?.restart
      },
      close: () => closing ??= server?.close() ?? Promise.resolve(),
      onReady: (callback) => {
        if (server) {
          server.onReady(callback)
        }
        else {
          pendingReady.push(callback)
        }
      },
    },
    attach: (started) => {
      // A shutdown started before this existed had nothing to close.
      if (closing) {
        closing = closing.then(() => started.close())
        return
      }
      server = started
      for (const callback of pendingReady.splice(0)) {
        started.onReady(callback)
      }
    },
  }
}
