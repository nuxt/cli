import type { PanelState } from './panel'
import type { DevUISupportOptions } from './support'

import process from 'node:process'

import { getPkgVersion } from '../../utils/pkg'
import { resolveBackground } from '../../utils/terminal-theme'
import { DEFAULT_HINTS, renderPanel } from './panel'
import { resolveDevUISupport, supportsUnicode } from './support'
import { PanelSurface } from './surface'

export interface PanelStart {
  surface: PanelSurface
  state: PanelState
}

export interface PanelStartOptions extends DevUISupportOptions {
  version?: string
  cwd?: string
  startTime?: number
}

/** The panel as it looks before anything has been loaded. */
export function createPanelState(options: PanelStartOptions = {}): PanelState {
  const cwd = options.cwd || process.cwd()
  return {
    status: 'starting',
    version: options.version || getPkgVersion(cwd, 'nuxt') || getPkgVersion(cwd, 'nuxt-nightly') || undefined,
    warnings: 0,
    errors: 0,
    ascii: !supportsUnicode(),
    background: resolveBackground(),
    loadStartedAt: options.startTime ?? Date.now(),
    elapsedMs: 0,
    progress: 0,
    hints: DEFAULT_HINTS,
    hintsDimmed: true,
  }
}

export function renderPanelState(surface: PanelSurface, state: PanelState): void {
  surface.render(panelLines(state))
}

function panelLines(state: PanelState): string[] {
  return renderPanel(state, process.stdout.columns || 80, process.stdout.rows || 24)
}

/**
 * Put the panel on screen before the session that drives it exists.
 *
 * Log capture, the event log and the progress feed all cost more to load than
 * the frame, and none of them has anything to show yet.
 */
export function paintFirstFrame(options: PanelStartOptions = {}): PanelStart | undefined {
  if (!resolveDevUISupport(options).enabled) {
    return undefined
  }
  const state = createPanelState(options)
  const surface = new PanelSurface()
  // Until the session takes over, the frame repaints itself.
  surface.onResize(() => renderPanelState(surface, state))
  surface.renderAtBottom(panelLines(state))
  return { surface, state }
}
