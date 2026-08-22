export interface DevRequest {
  /** Identity shared with attributed log events, when the server reported one. */
  id?: number
  time: number
  method: string
  url: string
  status: number
  duration: number
  /** Served by the bundler (module graph, HMR plumbing) rather than the app. */
  internal?: boolean
}

/** Rolling history of served requests, backing the ticker and the traffic view. */
export class RequestLog {
  #requests: DevRequest[] = []
  #listeners = new Set<() => void>()
  #capacity: number
  #total = 0

  constructor(capacity = 1000) {
    this.#capacity = capacity
  }

  /** Requests served since the session started, including any dropped from the buffer. */
  get total(): number {
    return this.#total
  }

  push(requests: DevRequest[]): void {
    if (!requests.length) {
      return
    }
    this.#total += requests.length
    this.#requests.push(...requests)
    if (this.#requests.length > this.#capacity) {
      this.#requests.splice(0, this.#requests.length - this.#capacity)
    }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  recent(count: number, filter?: (request: DevRequest) => boolean): DevRequest[] {
    const source = filter ? this.#requests.filter(filter) : this.#requests
    return source.slice(-count)
  }

  last(): DevRequest | undefined {
    return this.#requests.at(-1)
  }

  /**
   * Median is used rather than the mean so one cold start does not skew it.
   * Bundler-served module requests are excluded when any app traffic exists:
   * hundreds of sub-millisecond module fetches say nothing about the app.
   */
  medianDuration(): number {
    if (!this.#requests.length) {
      return 0
    }
    const app = this.#requests.filter(request => !request.internal)
    const pool = app.length ? app : this.#requests
    const sorted = pool.map(request => request.duration).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }

  /** Drop the history and the running total, telling anyone displaying them. */
  clear(): void {
    this.#requests.length = 0
    this.#total = 0
    for (const listener of this.#listeners) {
      listener()
    }
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}
