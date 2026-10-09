import type { Tunnel, TunnelOptions } from './types'

import { logger } from '../../utils/logger'

export type { Tunnel, TunnelOptions } from './types'

export interface TunnelTarget {
  protocol: 'http' | 'https'
  port: number
  /** The server is taking over from a process that still serves the port. */
  handover?: boolean
}

/**
 * Start the tunnel `options` asks for, in front of the dev server on `port`.
 * Each provider is imported on demand: `cloudflared` pulls in the download and
 * consent prompts, and OpenTunnel loads its SDK from the project.
 */
export async function startTunnel(options: TunnelOptions, target: TunnelTarget): Promise<Tunnel | undefined> {
  if (options.provider === 'opentunnel') {
    // OpenTunnel terminates TLS itself and forwards plain TCP, which an HTTPS
    // dev server cannot read.
    if (target.protocol === 'https') {
      logger.warn('OpenTunnel cannot forward to an HTTPS dev server. Using a Cloudflare quick tunnel instead.')
    }
    else {
      const { startOpenTunnel } = await import('./opentunnel')
      return startOpenTunnel(options.route, target.port, { handover: target.handover, rootDir: options.rootDir })
    }
  }
  const { startCloudflaredTunnel } = await import('./cloudflared')
  return startCloudflaredTunnel(`${target.protocol}://localhost:${target.port}`, target.protocol === 'https')
}
