import type { Tunnel, TunnelOptions } from './types'

import { logger } from '../../utils/logger'

export type { Tunnel, TunnelOptions } from './types'

export interface TunnelTarget {
  protocol: 'http' | 'https'
  /** The address the dev server is bound to: empty, `0.0.0.0` or `::` for every interface. */
  hostname: string
  port: number
  /** The server is taking over from a process that still serves the port. */
  handover?: boolean
}

const ANY_HOSTS = new Set(['', '0.0.0.0', '::'])

/**
 * Where the tunnel reaches the dev server, as `host:port`: `localhost` when it
 * listens on every interface, and otherwise the one address it is bound to, as
 * `localhost` may not resolve to it.
 */
export function formatTunnelTarget({ hostname, port }: Pick<TunnelTarget, 'hostname' | 'port'>): string {
  const host = ANY_HOSTS.has(hostname) ? 'localhost' : hostname
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}

/**
 * Start the tunnel `options` asks for, in front of the dev server at `target`.
 * Each provider is imported on demand: `cloudflared` pulls in the download and
 * consent prompts, and OpenTunnel loads its SDK from the project.
 */
export async function startTunnel(options: TunnelOptions, target: TunnelTarget): Promise<Tunnel | undefined> {
  const local = formatTunnelTarget(target)
  if (options.provider === 'opentunnel') {
    // OpenTunnel terminates TLS itself and forwards plain TCP, which an HTTPS
    // dev server cannot read.
    if (target.protocol === 'https') {
      logger.warn('OpenTunnel cannot forward to an HTTPS dev server. Using a Cloudflare quick tunnel instead.')
    }
    else {
      const { startOpenTunnel } = await import('./opentunnel')
      return startOpenTunnel(options.route, local, { handover: target.handover, rootDir: options.rootDir })
    }
  }
  const { startCloudflaredTunnel } = await import('./cloudflared')
  return startCloudflaredTunnel(`${target.protocol}://${local}`, target.protocol === 'https')
}
