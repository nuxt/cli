import type { OpenTunnelClientEvent, OpenTunnelConnection, OpenTunnelIdentity, OpenTunnelPromiseClient, OpenTunnelProvisionStage, OpenTunnelRoutes } from '@opentunnel/client'
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
 * Expose the dev server at `target` (`host:port`) as `https://<route>.<hostname>`
 * through the user's default OpenTunnel profile, the one the `opentunnel` CLI
 * also uses.
 *
 * TLS terminates in this process, so the relay never sees plaintext. The route
 * only exists while the bridge is attached: nothing keeps running once the dev
 * server stops.
 */
export async function startOpenTunnel(route: string, target: string, options: OpenTunnelOptions): Promise<Tunnel | undefined> {
  const sdk = await loadOpenTunnelSDK(options.rootDir)
  if (!sdk) {
    return undefined
  }
  const client = sdk.create()
  const routes = { [route]: target }
  try {
    const identity = await client.tunnel.get()
      ?? await withTimeout(provision(client), PROVISION_TIMEOUT_MS, 'Timed out waiting for the tunnel certificate')
    if (options.handover) {
      return attachInBackground(client, routes, sdk.publicUrl(route, identity.hostname))
    }
    const connection = await connect(client, routes)
    return {
      url: connection.urls[route]!,
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

/**
 * Attach the bridge, giving up after {@link CONNECT_TIMEOUT_MS}. A route held by
 * another bridge is retried forever by default, so the first conflict stops the
 * attach: another `nuxt dev` serves this project. Conflicts on later reconnects
 * still retry, as the server may hold this process's own previous bridge.
 */
async function connect(client: OpenTunnelPromiseClient, routes: OpenTunnelRoutes): Promise<OpenTunnelConnection> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Timed out connecting to the OpenTunnel relay')), CONNECT_TIMEOUT_MS)
  let attached = false
  try {
    return await client.tunnel.connect({
      routes,
      signal: controller.signal,
      onEvent: (event) => {
        attached ||= event.type === 'connected'
        if (event.type === 'route-conflict' && !attached) {
          controller.abort(new Error('its URL is in use by another process, probably another `nuxt dev` for this project'))
        }
        reportEvent(event)
      },
    })
  }
  finally {
    clearTimeout(timer)
  }
}

/** Return the handover URL immediately and attach the bridge when the route becomes available. */
function attachInBackground(client: OpenTunnelPromiseClient, routes: OpenTunnelRoutes, url: string): Tunnel {
  const controller = new AbortController()
  const connecting = client.tunnel.connect({ routes, signal: controller.signal, onEvent: reportEvent }).then(
    (connection) => {
      debug('OpenTunnel attached after handover')
      return connection
    },
    (error) => {
      if (!controller.signal.aborted) {
        logger.warn(`Could not reattach the OpenTunnel: ${describeError(error)}`)
      }
      return undefined
    },
  )
  return {
    url,
    close: async () => {
      // Stops a bridge still waiting for the route, or closes an attached one.
      controller.abort()
      await closeConnection(client, await connecting)
    },
  }
}

/** Close any attached bridge and dispose the client, logging shutdown failures or timeouts. */
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

/** Warn when the bridge stops on an error, and log other events for debugging. */
function reportEvent(event: OpenTunnelClientEvent): void {
  if (event.type === 'stopped' && event.error) {
    logger.warn(`OpenTunnel stopped: ${event.error}`)
  }
  else {
    debug('OpenTunnel event:', event)
  }
}

/**
 * Create the profile's tunnel, or finish one an earlier run left waiting for
 * its certificate, with progress, as a first run takes a while.
 */
function provision(client: OpenTunnelPromiseClient): Promise<OpenTunnelIdentity> {
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
      const identity = await client.tunnel.ensure({ onProgress })
      const done = `Created ${identity.hostname}`
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

/** Reject with `message` after `ms`, clearing the timer without cancelling the underlying operation. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(reject, ms, new Error(message))
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Format an error with its immediate cause, or stringify a non-Error value. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}
