import type { DevRequestSpan } from '../span-channel'

export interface DevRequest {
  /** Identity shared with attributed log events, when the server reported one. */
  id?: string
  time: number
  /** Epoch milliseconds at which the server received it, fractional. */
  start?: number
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
  #spans = new Map<string, DevRequestSpan[]>()

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
      for (const dropped of this.#requests.splice(0, this.#requests.length - this.#capacity)) {
        if (dropped.id !== undefined) {
          this.#spans.delete(dropped.id)
        }
      }
    }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /** Record spans the app timed, against the requests they were timed for. */
  pushSpans(spans: DevRequestSpan[]): void {
    if (!spans.length) {
      return
    }
    for (const span of spans) {
      const list = this.#spans.get(span.requestId)
      if (list) {
        list.push(span)
      }
      else {
        this.#spans.set(span.requestId, [span])
      }
    }
    // Spans can arrive for a request whose own event never does; bound them too.
    while (this.#spans.size > this.#capacity) {
      this.#spans.delete(this.#spans.keys().next().value!)
    }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /** The spans timed for a request, in the order they started, outermost first. */
  spansFor(request: DevRequest): DevRequestSpan[] {
    if (request.id === undefined) {
      return []
    }
    return [...this.#spans.get(request.id) ?? []].sort((a, b) => a.start - b.start || b.duration - a.duration)
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
    this.#spans.clear()
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
