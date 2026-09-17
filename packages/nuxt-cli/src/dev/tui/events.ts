import { stripAnsi } from './width'

export type DevLogSource = 'cli' | 'build' | 'runtime'

export interface DevLogEvent {
  time: number
  /** consola log level (`0` fatal/error, `1` warn, `2` log, `3+` info and below). */
  level: number
  /** consola log type (`error`, `warn`, `info`, `log`, ...). */
  type: string
  tag?: string
  message: string
  /** The formatted output as it would have been printed, colour and all. */
  rendered?: string
  /** The message carries its own colours, so severity styling must not be applied. */
  styled?: boolean
  /** Recovered from printed output rather than reported by a logger. */
  raw?: boolean
  /** Already paired with the other route the same log arrived by. */
  paired?: boolean
  /** Already written into scrollback, so it is not shown a second time. */
  surfaced?: boolean
  source: DevLogSource
  /** The request this was most likely emitted for. */
  request?: string
  /**
   * Identifies the individual request, so two sequential requests to the same
   * path are not mistaken for one.
   */
  requestId?: number
  /** How many times this has been reported, when deduplicated. */
  repeats?: number
}

/**
 * Badges that tools print themselves, in the order they are tested.
 *
 * Output arriving as plain text has already been formatted by whatever produced
 * it, so its severity only exists in the text.
 */
const BADGES: Array<{ pattern: RegExp, level: number, type: string }> = [
  { pattern: /^\s*fatal\b[\s:]*/i, level: 0, type: 'fatal' },
  { pattern: /^\s*err(?:or)?\b[\s:]*/i, level: 0, type: 'error' },
  { pattern: /^\s*warn(?:ing)?\b[\s:]*/i, level: 1, type: 'warn' },
]

/**
 * Text as it reads, so a difference in padding cannot make two logs distinct.
 * Backticks go too: a structured report keeps its markdown quoting while the
 * printed form renders it, and the same words must compare equal either way.
 */
export function normaliseMessage(text: string): string {
  return stripAnsi(text).replaceAll('`', '').replace(/\s+/g, ' ').trim()
}

/**
 * Box drawing and the ASCII fallback's `>` gutter, so a boxed log can be
 * recognised as the printed form of the message it was built from. The borders
 * sit between every line of the message, which plain containment cannot see
 * past.
 */
const BOX_DECORATION_RE = /[\u2500-\u257F]|^[ \t]*>[ \t]?/gm

/** Text as it reads with any box the printer drew around it taken off. */
function undecorate(text: string): string {
  return normaliseMessage(stripAnsi(text).replaceAll(BOX_DECORATION_RE, ' '))
}

/**
 * Whether the event is asking the user for something rather than reporting.
 *
 * A tool only draws a box around output it needs read, and what is inside is
 * usually a URL to open or a token to paste: useless unheeded, and useless
 * truncated onto a status line. Tools that know the terminal host say so
 * through `notify` instead; a box is how everything else says it.
 */
export function isBoxedNotice(event: DevLogEvent): boolean {
  return event.type === 'box'
}

/** Either text may carry a badge the other does not, so neither has to be exact. */
function sameMessage(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a)
}

/**
 * The core complaint of an error, for recognising the same problem described
 * by different tools. Each wraps it in its own prose (`Internal server error:
 * …`, `/pages/index.vue — …`, `[plugin] …`) and follows it with its own
 * stack or code frame, so whole-text containment cannot pair them; the first
 * line with the wrapping removed can.
 */
function errorSignature(message: string): string | undefined {
  const first = stripAnsi(message).split('\n', 1)[0]!.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/^\s*(?:internal server error|pre-transform error|transform failed|error|fatal)\s*:\s*/i, '').replace(/^\s*\S+ — /, '').replace(/[`\s]+/g, ' ').trim()
  // Too short a remainder is generic enough to pair unrelated problems.
  return first.length >= 10 ? first.toLowerCase() : undefined
}

/**
 * Recover the severity of an event whose level says nothing, since anything a
 * tool writes to stdout reaches us as a generic log.
 *
 * Badges usually arrive wrapped in colour, so matching happens against plain
 * text. Only an uncoloured badge is cut from the message: slicing through an
 * escape sequence would drop the reset and leave the rest of the line styled.
 *
 * A boxed notice already knows what it is, and inferring a severity from its
 * opening words would rewrite it into a warning that no longer reaches the
 * panel as one.
 */
function classify(event: DevLogEvent): DevLogEvent {
  if (event.level < 2 || isBoxedNotice(event)) {
    return event
  }
  const plain = stripAnsi(event.message)
  for (const { pattern, level, type } of BADGES) {
    const match = plain.match(pattern)
    if (match) {
      const message = plain === event.message ? event.message.slice(match[0].length) : event.message
      return { ...event, level, type, message }
    }
  }
  return event
}

/** How far back a merge or pairing looks for a match. */
const RECENT_SCAN = 20

/**
 * How close together two reports of the same problem have to be to collapse
 * into one entry. Vite, the Vue plugin and Nitro each describe a failing
 * transform in their own words within a few hundred milliseconds, and every
 * request to a broken page repeats all of them.
 */
const DEDUPE_WINDOW_MS = 3000

/**
 * Structured log history for the dev session, independent of what was printed.
 *
 * The terminal shows formatted output as it always has; this is the backing
 * store for everything that interrogates the past: the error badge, the jump
 * to the last error, retroactive filtering and the log view.
 */
export class DevEventLog {
  #events: DevLogEvent[] = []
  #listeners = new Set<(event: DevLogEvent, merged?: boolean) => void>()
  #clearListeners = new Set<() => void>()
  #capacity: number

  constructor(capacity = 10_000) {
    this.#capacity = capacity
  }

  /**
   * Record `event`, returning it as stored so callers can amend it later.
   *
   * With `absorb`, an entry already recovered from printed output that says the
   * same thing is upgraded in place instead of a second one being added.
   */
  push(event: DevLogEvent, options: { absorb?: boolean } = {}): DevLogEvent {
    const merged = options.absorb ? this.#absorb(event) : event.raw ? this.#attribute(event) : undefined
    if (merged) {
      return merged
    }
    const stored = classify(event)
    const deduped = this.#dedupe(stored)
    if (deduped) {
      return deduped
    }
    this.#events.push(stored)
    if (this.#events.length > this.#capacity) {
      this.#events.splice(0, this.#events.length - this.#capacity)
    }
    for (const listener of this.#listeners) {
      listener(stored)
    }
    return stored
  }

  /**
   * Attach printed output to the event it belongs to, when one is waiting for
   * it, returning whether a home was found for `chunk`.
   *
   * A log forwarded from a fork arrives over IPC while its output arrives down a
   * pipe, so the two cannot be paired by ordering alone.
   */
  attachRendered(chunk: string, plain: string, withinMs = 500): boolean {
    const text = normaliseMessage(plain)
    if (!text) {
      return false
    }
    const boxed = undecorate(plain)
    const now = Date.now()
    for (let index = this.#events.length - 1; index >= 0 && index > this.#events.length - RECENT_SCAN; index--) {
      const event = this.#events[index]!
      if (now - event.time > withinMs) {
        return false
      }
      const message = normaliseMessage(event.message)
      // A boxed notice that has already been printed keeps the output it was
      // paired with: a repeat of it was collapsed into that entry, so its
      // second printing has no other home.
      if (message && (text.includes(message) || boxed.includes(message)) && (!event.rendered || isBoxedNotice(event))) {
        event.rendered ??= chunk
        return true
      }
    }
    return false
  }

  /** Hand printed output to the attributed report of the same log. */
  #attribute(event: DevLogEvent): DevLogEvent | undefined {
    return this.#merge(event, candidate => !candidate.raw && !candidate.paired && candidate.requestId !== undefined, (candidate) => {
      candidate.rendered ??= event.rendered
      candidate.paired = true
    })
  }

  #absorb(event: DevLogEvent): DevLogEvent | undefined {
    return this.#merge(event, candidate => !!candidate.raw && !candidate.paired, (candidate) => {
      Object.assign(candidate, { ...event, rendered: candidate.rendered, raw: false })
      candidate.paired = true
    })
  }

  /**
   * Collapse another report of a problem already on record into that record.
   *
   * One broken transform is described by every tool that meets it, each in its
   * own words, and again on every request. The entry keeps the longest wording
   * (the one with the file and the stack) and counts the rest.
   */
  #dedupe(event: DevLogEvent): DevLogEvent | undefined {
    if (event.level > 1 && !isBoxedNotice(event)) {
      return undefined
    }
    const signature = errorSignature(event.message)
    const sameProblem = (candidate: DevLogEvent) => !!signature && signature === errorSignature(candidate.message)
    // A boxed notice only ever joins another one. Folded into a warning it
    // would leave the entry a warning, reported as a merge, and the attention
    // the box was drawn to ask for would never be raised. The other direction
    // is welcome: a warning saying the same thing joins the box and the box
    // keeps the notice it already raised.
    const matches = isBoxedNotice(event)
      ? isBoxedNotice
      : (candidate: DevLogEvent) => candidate.level <= 1 || isBoxedNotice(candidate)
    return this.#merge(event, matches, (candidate) => {
      candidate.repeats = (candidate.repeats ?? 1) + 1
      if (normaliseMessage(candidate.message).length < normaliseMessage(event.message).length) {
        candidate.message = event.message
        candidate.rendered = event.rendered ?? candidate.rendered
      }
      candidate.requestId ??= event.requestId
      candidate.request ??= event.request
    }, DEDUPE_WINDOW_MS, sameProblem)
  }

  /**
   * The most recent event saying the same thing, updated in place.
   *
   * A match is consumed rather than filtered against, so two logs that happen to
   * say the same thing pair off one to one instead of collapsing into one.
   */
  #merge(event: DevLogEvent, matches: (candidate: DevLogEvent) => boolean, apply: (candidate: DevLogEvent) => void, withinMs = 500, alsoSame?: (candidate: DevLogEvent) => boolean): DevLogEvent | undefined {
    const text = normaliseMessage(event.message)
    if (!text) {
      return undefined
    }
    const now = Date.now()
    for (let index = this.#events.length - 1; index >= 0 && index > this.#events.length - RECENT_SCAN; index--) {
      const candidate = this.#events[index]!
      if (now - candidate.time > withinMs) {
        return undefined
      }
      if (matches(candidate) && (sameMessage(normaliseMessage(candidate.message), text) || alsoSame?.(candidate))) {
        apply(candidate)
        for (const listener of this.#listeners) {
          listener(candidate, true)
        }
        return candidate
      }
    }
    return undefined
  }

  recent(count: number, filter?: (event: DevLogEvent) => boolean): DevLogEvent[] {
    const source = filter ? this.#events.filter(filter) : this.#events
    return source.slice(-count)
  }

  onEvent(listener: (event: DevLogEvent, merged?: boolean) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Drop the history, telling anyone counting or displaying it. */
  clear(): void {
    this.#events.length = 0
    for (const listener of this.#clearListeners) {
      listener()
    }
  }

  onClear(listener: () => void): () => void {
    this.#clearListeners.add(listener)
    return () => this.#clearListeners.delete(listener)
  }
}
