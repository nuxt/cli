export interface Tunnel {
  url: string
  close: () => Promise<void>
}

const TUNNEL_PROVIDERS = ['cloudflare', 'opentunnel'] as const

export type TunnelProvider = typeof TUNNEL_PROVIDERS[number]

/** Values `--tunnel` accepts, with `cloudflared` as an alias of `cloudflare`. */
export const TUNNEL_FLAG_VALUES: readonly string[] = [...TUNNEL_PROVIDERS, 'cloudflared']

/**
 * How `--tunnel` was resolved. The OpenTunnel route name is resolved once, in
 * the process that parsed the flag, so every fork serves the same URL.
 */
export type TunnelOptions
  = | { provider: 'cloudflare' }
    | {
      provider: 'opentunnel'
      route: string
      /** The project the OpenTunnel SDK is installed in. */
      rootDir: string
    }
