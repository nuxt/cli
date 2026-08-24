import type { DevProgressSnapshot } from './progress'

/**
 * The scripts inlined into the dev server's loading and error pages.
 *
 * Each is serialised with `Function.prototype.toString()` and called with its
 * options, so it must stay self-contained: a reference to anything outside its
 * own body would be renamed by the bundler and undefined in the browser. Only
 * types may be imported here, since those are erased.
 */

export interface ProgressClientOptions {
  progressPath: string
  /** Id of the caption element, which doubles as the marker the poll looks for. */
  captionId: string
  /** Custom property the loading bar's width is bound to. */
  progressProperty: string
  /** How far the load had got when this page was served. */
  elapsed: number
  /** Wait after the first request for the app, from which later waits back off. */
  pollInterval: number
  /** Ceiling the wait between those requests backs off to. */
  maxPollInterval: number
}

export function progressClient(options: ProgressClientOptions): void {
  const caption = document.createElement('div')
  caption.id = options.captionId
  document.body.append(caption)

  let start = Date.now() - options.elapsed
  let label = ''

  function paint(): void {
    const seconds = `${((Date.now() - start) / 1000).toFixed(1)}s`
    caption.textContent = label ? `${label} \u00B7 ${seconds}` : seconds
  }

  function apply(snapshot: DevProgressSnapshot): void {
    start = Date.now() - snapshot.elapsed
    // The message, not the phase id: it carries whatever detail the server has,
    // such as the module currently being set up, and this page is what the user
    // is looking at for most of a cold start.
    const message = /^[A-Z][a-z]/.test(snapshot.message)
      ? snapshot.message[0]!.toLowerCase() + snapshot.message.slice(1)
      : snapshot.message
    label = `${message} \u00B7 step ${snapshot.index + 1}/${snapshot.total + 1}`
    const percent = Math.max(4, Math.round(snapshot.progress * 100))
    document.documentElement.style.setProperty(options.progressProperty, `${percent}%`)
    if (snapshot.message && !document.title.startsWith(snapshot.message)) {
      document.title = snapshot.message
    }
    paint()
  }

  function read(event: Event): DevProgressSnapshot | undefined {
    try {
      return JSON.parse((event as MessageEvent).data)
    }
    catch {
      return undefined
    }
  }

  setInterval(paint, 100)

  const source = new EventSource(options.progressPath)
  let polling = false

  source.addEventListener('nuxt:loading', (event) => {
    const snapshot = read(event)
    if (snapshot) {
      apply(snapshot)
    }
  })

  // The dev server answers with the error page itself, which reports the failure
  // properly and recovers on its own, so there is nothing to render here.
  source.addEventListener('nuxt:error', () => {
    source.close()
    location.reload()
  })

  source.addEventListener('nuxt:ready', (event) => {
    // Repeats of this event while polling only matter if a rebuild finished,
    // whose warm caches make it safe to reload at once.
    if (polling) {
      if (read(event)?.reload) {
        source.close()
        location.reload()
      }
      return
    }
    const snapshot = read(event)
    // Use the server's wording so the terminal, the caption and the tab agree.
    const message = snapshot && !snapshot.serving && snapshot.message ? snapshot.message : 'Starting the app'
    label = message.charAt(0).toLowerCase() + message.slice(1)
    document.title = message

    // A reload leaves the caches warm, so there is nothing left to wait for.
    if (snapshot?.reload) {
      source.close()
      document.documentElement.style.setProperty(options.progressProperty, '100%')
      paint()
      location.reload()
      return
    }

    // Hold the bar short of full while the caption still says starting.
    const fraction = typeof snapshot?.progress === 'number' && snapshot.progress > 0 ? Math.min(snapshot.progress, 1) : 1
    document.documentElement.style.setProperty(options.progressProperty, `${Math.round(fraction * 100)}%`)
    paint()

    // `nuxt:ready` means the request handler exists, not that it can answer
    // yet: the first document still has to be compiled. So this page stays and
    // asks until the app answers, one request at a time with backoff, since the
    // dev server serialises the first render anyway. The event stream stays
    // open meanwhile: the server takes the last stream closing as the sign
    // that nobody is waiting on a first render any more.
    polling = true
    const controller = new AbortController()
    let wait = options.pollInterval

    const attempt = async (): Promise<void> => {
      try {
        const response = await fetch(location.href, { headers: { accept: 'text/html' }, signal: controller.signal })
        const body = await response.text()
        if (!body.includes(options.captionId)) {
          controller.abort()
          source.close()
          location.reload()
          return
        }
      }
      catch {}
      if (controller.signal.aborted) {
        return
      }
      setTimeout(attempt, wait)
      wait = Math.min(Math.round(wait * 1.5), options.maxPollInterval)
    }

    void attempt()
  })
}

export interface RecoveryClientOptions {
  progressPath: string
}

/** Reloads the error page as soon as the next load starts or succeeds. */
export function recoveryClient(options: RecoveryClientOptions): void {
  const source = new EventSource(options.progressPath)
  let reloading = false
  const reload = (): void => {
    if (reloading) {
      return
    }
    reloading = true
    source.close()
    location.reload()
  }
  source.addEventListener('nuxt:ready', reload)
  source.addEventListener('nuxt:loading', reload)
}

/** Serialise a client function and its options into an inline `<script>`. */
export function inlineScript<T>(client: (options: T) => void, options: T): string {
  return `<script>(${client.toString()})(${JSON.stringify(options)})</script>`
}
