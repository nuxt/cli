import type { ServerResponse } from 'node:http'

/**
 * A safety valve rather than a tuning knob: longer than any first render
 * measured on a large project, so a leader that never answers cannot hold a
 * page open indefinitely.
 */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Serialises the first page render, so a cold start pays for it once.
 *
 * The first render of any route compiles the module graph the whole app shares.
 * Two at once compile it twice and contend, so two tabs on a cold start are
 * slower than one; a second render afterwards costs tens of milliseconds.
 *
 * Not a cache: every request is still served by the app, so anything
 * per-request behaves as it would without the gate. Global rather than
 * per-URL, because what is being warmed is the graph and not the route.
 */
export class WarmupGate {
  #warmed = false
  #leader?: Promise<void>
  #timeout: number

  constructor(options: { timeout?: number } = {}) {
    this.#timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
  }

  /** Whether a page has been rendered, after which the gate does nothing. */
  get warmed(): boolean {
    return this.#warmed
  }

  /** Gate the next load again, because it will compile from cold once more. */
  rearm(): void {
    this.#warmed = false
  }

  /**
   * Resolves when this request may be handed to the app: at once while nothing
   * is rendering, otherwise as soon as the render ahead of it has finished,
   * given up, or run out of time. Only page renders should be handed here.
   */
  async admit(res: ServerResponse): Promise<void> {
    if (this.#warmed) {
      return
    }

    const deadline = Date.now() + this.#timeout
    while (!this.#warmed && this.#leader) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return
      }
      let timer: NodeJS.Timeout | undefined
      await Promise.race([
        this.#leader,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remaining)
          timer.unref?.()
        }),
      ])
      clearTimeout(timer)
      // A client that has gone away must not take the lead, or the next real
      // request would wait on a render nobody is receiving.
      if (res.destroyed || res.writableEnded) {
        return
      }
    }
    if (this.#warmed) {
      return
    }

    let release = (): void => {}
    this.#leader = new Promise<void>((resolve) => {
      release = resolve
    })
    let settled = false
    let expiry: NodeJS.Timeout | undefined
    const finish = (warmed: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(expiry)
      // A failed render warmed nothing, so the request behind it gets its own
      // chance rather than inheriting the failure.
      this.#warmed = warmed
      this.#leader = undefined
      release()
    }
    expiry = setTimeout(finish, this.#timeout, false)
    expiry.unref?.()
    res.once('close', () => finish(res.writableEnded && res.statusCode < 500))
  }
}
