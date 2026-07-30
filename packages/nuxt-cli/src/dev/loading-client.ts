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
  /** How often to ask for the app once the server says it is ready. */
  pollInterval: number
}

export function progressClient(options: ProgressClientOptions): void {
  const caption = document.createElement('div')
  caption.id = options.captionId
  document.body.append(caption)

  let start = Date.now() - options.elapsed
  let phase = ''

  function paint(): void {
    const seconds = `${((Date.now() - start) / 1000).toFixed(1)}s`
    caption.textContent = phase ? `${phase} \u00B7 ${seconds}` : seconds
  }

  function apply(snapshot: DevProgressSnapshot): void {
    start = Date.now() - snapshot.elapsed
    phase = `${snapshot.phase} \u00B7 step ${snapshot.index + 1}/${snapshot.total + 1}`
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
    source.close()
    phase = 'starting the app'
    document.documentElement.style.setProperty(options.progressProperty, '100%')
    paint()

    // A reload leaves the caches warm, so there is nothing left to wait for.
    if (read(event)?.reload) {
      location.reload()
      return
    }

    // `nuxt:ready` means the request handler exists, not that it can render
    // quickly: on a cold start the first response still contends with the
    // warmup the server is finishing, and asking for it at once measured 2-3x
    // slower than asking a few hundred milliseconds later. So this page stays,
    // still reporting progress, and asks until the app answers. Doing that here
    // rather than leaving it to the template means every page the dev server
    // serves updates itself, so none of them needs a `Refresh` header whose
    // hard reload would throw the progress away every few seconds.
    const poll = setInterval(() => {
      void fetch(location.href, { headers: { accept: 'text/html' } })
        .then(response => response.text())
        .then((body) => {
          if (!body.includes(options.captionId)) {
            clearInterval(poll)
            location.reload()
          }
        })
        .catch(() => {})
    }, options.pollInterval)
  })
}

export interface RecoveryClientOptions {
  progressPath: string
}

/** Reloads the error page as soon as the next load starts or succeeds. */
export function recoveryClient(options: RecoveryClientOptions): void {
  const source = new EventSource(options.progressPath)
  const reload = (): void => {
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
