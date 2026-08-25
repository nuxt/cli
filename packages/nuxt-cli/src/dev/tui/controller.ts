import type { PendingRender } from '../../utils/progress-snapshot'
import type { ServerLogEvent } from '../log-channel'
import type { ShortcutContext } from '../shortcuts'
import type { DevRequestEvent, DevRoutes } from '../utils'
import type { DevUIOptions } from './index'
import type { DevStatus } from './panel'
import type { DevUISession } from './session'

/** A {@link ServerLogEvent} from a source that may not know where it came from. */
type ForwardedLog = Omit<ServerLogEvent, 'origin'> & { origin?: ServerLogEvent['origin'] }

export interface DevUIController {
  /** Whether the interactive UI is active (rather than the plain fallback). */
  interactive: boolean
  setStatus: (status: DevStatus, note?: string) => void
  /** Record a structured log event forwarded from the dev server fork. */
  pushServerLog: (log: ForwardedLog) => void
  /** Record a batch of served requests for the traffic ticker. */
  pushRequests: (requests: DevRequestEvent[]) => void
  /** Replace the routes shown in the route view. */
  setRoutes: (routes: DevRoutes) => void
  /**
   * Report the render the server is busy with, or that it is busy with none.
   * `awaiting` says no page has been rendered yet, which is what makes it a
   * warmup rather than one request among many.
   */
  setRendering: (pending?: PendingRender, awaiting?: boolean) => void
}

/** What the plain fallback answers to everything the UI would have shown. */
export const NOOP_CONTROLLER: DevUIController = {
  interactive: false,
  setStatus: () => {},
  pushServerLog: () => {},
  pushRequests: () => {},
  setRoutes: () => {},
  setRendering: () => {},
}

/**
 * Take the terminal, if this one can host the UI.
 *
 * Nothing behind this module is loaded until a panel is actually going to be
 * painted: `nuxt dev --help` never gets that far, and a plain session has no
 * use for the panel, the views, the update check or the version lookup.
 */
export async function beginDevUI(options: DevUIOptions = {}): Promise<DevUISession | undefined> {
  const { resolveDevUISupport } = await import('./support')
  if (options.enabled === false || !resolveDevUISupport(options).enabled) {
    return undefined
  }
  const { beginDevUI } = await import('./session')
  return beginDevUI(options)
}

/** The interactive controller, or the line-based shortcuts and a no-op. */
export async function setupDevUI(context: ShortcutContext, options: DevUIOptions = {}): Promise<DevUIController> {
  if (options.enabled === false) {
    const { setupShortcuts } = await import('../shortcuts')
    setupShortcuts(context)
    return NOOP_CONTROLLER
  }
  const { setupDevUI } = await import('./index')
  return setupDevUI(context, options)
}
