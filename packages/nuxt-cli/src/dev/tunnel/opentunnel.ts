import type { OpenTunnelConnection, OpenTunnelPromiseClient, OpenTunnelProvisionStage } from '@opentunnel/client'
import type { Tunnel } from './types'

import process from 'node:process'

import { spinner } from '@clack/prompts'

import { restoreRawMode, withDirectStdout } from '../../utils/console'
import { debug, logger } from '../../utils/logger'
import { withUserAttention } from '../../utils/startup-clock'
import { loadOpenTunnelSDK } from './opentunnel-loader'

/** How long the bridge has to attach once the tunnel has a certificate. */
const CONNECT_TIMEOUT_MS = 20_000
/** A first run waits for a certificate to be issued, which takes about half a minute. */
const PROVISION_TIMEOUT_MS = 120_000
/** How long to wait for the bridge to close on shutdown. */
const SHUTDOWN_TIMEOUT_MS = 5000

const STAGE_MESSAGES: Partial<Record<OpenTunnelProvisionStage, string>> = {
  'creating-tunnel': 'Creating your OpenTunnel hostname',
  'generating-key': 'Generating the tunnel private key',
  'generating-csr': 'Generating the tunnel private key',
  'resuming-certificate': 'Waiting for the TLS certificate',
  'requesting-certificate': 'Waiting for the TLS certificate',
  'waiting-certificate': 'Waiting for the TLS certificate',
  'saving-identity': 'Saving the tunnel identity',
}

export interface OpenTunnelOptions {
  /** The project the SDK is installed in. */
  rootDir: string
  /**
   * The process being taken over still holds the route, and the relay only
   * attaches it here once that process lets go, which it does only after this
   * one is serving. Waiting for the attach would deadlock the handover, so the
   * URL is returned straight away and the bridge attaches in the background.
   */
  handover?: boolean
}

/**
 * Expose `localhost:<port>` as `https://<route>.<hostname>` through the user's
 * default OpenTunnel profile, the one the `opentunnel` CLI also uses.
 *
 * TLS terminates in this process, so the relay never sees plaintext. The route
 * only exists while the bridge is attached: nothing keeps running once the dev
 * server stops.
 */
export async function startOpenTunnel(route: string, port: number, options: OpenTunnelOptions): Promise<Tunnel | undefined> {
  const sdk = await loadOpenTunnelSDK(options.rootDir)
  if (!sdk) {
    return undefined
  }
  const client = sdk.create()
  const routes = { [route]: `localhost:${port}` }
  try {
    const identity = await client.tunnel.get()
    if (identity && options.handover) {
      return attachInBackground(client, routes, `https://${route}.${identity.hostname}`)
    }
    if (!identity) {
      await withTimeout(provision(client), PROVISION_TIMEOUT_MS, 'Timed out waiting for the tunnel certificate')
    }
    const connection = await withTimeout(client.tunnel.connect({ routes }), CONNECT_TIMEOUT_MS, 'Timed out connecting to the OpenTunnel relay')
    watchEvents(connection)
    return {
      url: `https://${route}.${connection.tunnel.hostname}`,
      close: () => closeConnection(client, connection),
    }
  }
  catch (error) {
    await client.dispose().catch(() => {})
    debug('OpenTunnel failed:', error)
    logger.warn(`Could not open an OpenTunnel: ${describeError(error)}`)
    return undefined
  }
}

function attachInBackground(client: OpenTunnelPromiseClient, routes: Record<string, string>, url: string): Tunnel {
  let closing = false
  const connecting = client.tunnel.connect({ routes }).then(
    (connection) => {
      if (closing) {
        void connection.close().catch(() => {})
        return undefined
      }
      debug('OpenTunnel attached after handover')
      watchEvents(connection)
      return connection
    },
    (error) => {
      if (!closing) {
        logger.warn(`Could not reattach the OpenTunnel: ${describeError(error)}`)
      }
      return undefined
    },
  )
  return {
    url,
    close: async () => {
      closing = true
      // A bridge still waiting for the route has nothing to close yet.
      const connection = await Promise.race([connecting, new Promise<undefined>(resolve => setTimeout(resolve, 0))])
      await closeConnection(client, connection)
    },
  }
}

async function closeConnection(client: OpenTunnelPromiseClient, connection: OpenTunnelConnection | undefined): Promise<void> {
  try {
    await withTimeout(
      Promise.resolve(connection?.close()).finally(() => client.dispose()),
      SHUTDOWN_TIMEOUT_MS,
      'Timed out closing the tunnel',
    )
  }
  catch (error) {
    debug('Failed to close OpenTunnel:', error)
  }
}

function watchEvents(connection: OpenTunnelConnection): void {
  void (async () => {
    for await (const event of connection.events) {
      if (event.type === 'stopped' && event.error) {
        logger.warn(`OpenTunnel stopped: ${event.error}`)
      }
      else {
        debug('OpenTunnel event:', event)
      }
    }
  })().catch(error => debug('OpenTunnel event stream failed:', error))
}

/**
 * Create the profile's tunnel, or finish one an earlier run left waiting for
 * its certificate, with progress, as a first run takes a while.
 */
function provision(client: OpenTunnelPromiseClient): Promise<unknown> {
  return withUserAttention(() => withDirectStdout(async () => {
    const interactive = !!process.stdout.isTTY
    const indicator = interactive ? spinner() : undefined
    let last: string | undefined
    const onProgress = (stage: OpenTunnelProvisionStage) => {
      const message = STAGE_MESSAGES[stage]
      if (!message || message === last) {
        return
      }
      if (!indicator) {
        logger.info(message)
      }
      else if (last) {
        indicator.message(message)
      }
      else {
        indicator.start(message)
      }
      last = message
    }
    try {
      const identity = await client.tunnel.pending()
        ? await client.tunnel.resume({ onProgress })
        : await client.tunnel.create({ onProgress })
      const done = identity ? `Created ${identity.hostname}` : 'Created your OpenTunnel'
      if (indicator && last) {
        indicator.stop(done)
      }
      else {
        logger.success(done)
      }
      return identity
    }
    catch (error) {
      if (indicator && last) {
        indicator.error('Could not create your OpenTunnel')
      }
      throw error
    }
    finally {
      restoreRawMode()
    }
  }))
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(reject, ms, new Error(message))
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}
