import process from 'node:process'

export interface PortlessURLs {
  /** Stable proxy URL for the app, e.g. `https://myapp.localhost`. */
  url?: string
  /** Publicly reachable URL, when sharing via Tailscale Funnel or ngrok. */
  shareURL?: string
  /** Every portless-provided URL, for host allowlists and CORS origins. */
  all: string[]
}

/**
 * Resolve the URLs of the [portless](https://portless.sh) proxy, if the dev
 * server was started through it (`portless myapp nuxt dev`).
 *
 * portless runs as the parent process: it assigns a random `PORT`, proxies a
 * stable hostname to it, and passes the resulting URLs down in the environment.
 * Requests therefore arrive with a `Host` header we would otherwise reject.
 */
export function resolvePortlessURLs(env: NodeJS.ProcessEnv = process.env): PortlessURLs {
  const url = normalize(env.PORTLESS_URL)
  const shareURL = normalize(env.PORTLESS_NGROK_URL) || normalize(env.PORTLESS_TAILSCALE_URL)
  return {
    url,
    shareURL,
    all: [...new Set([url, shareURL].filter(Boolean) as string[])],
  }
}

function normalize(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  try {
    return new URL(value).origin
  }
  catch {
    return undefined
  }
}
