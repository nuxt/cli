import type { ShortcutContext } from '../shortcuts'
import type { DevRoutes } from '../utils'
import type { InfoSection } from './info-overlay'
import type { Key } from './keys'
import type { DevStatus, PanelState, PanelURL } from './panel'
import type { DevUISupportOptions } from './support'

import type { PanelSurface } from './surface'
import process from 'node:process'

import { styleText } from 'node:util'
import { resolveStackVersions } from '../../utils/banner'
import { withDirectStdout } from '../../utils/console'
import { startupElapsedMs } from '../../utils/startup-clock'
import { terminalLink } from '../../utils/terminal-link'
import { checkForUpdate, isUpdateCheckEnabled, releaseNotesUrl } from '../../utils/update-check'
import { openBrowser } from '../listen'
import { setupShortcuts } from '../shortcuts'
import { HelpOverlay } from './help-overlay'
import { InfoOverlay } from './info-overlay'
import { attachKeys } from './keys'
import { LOGO_FRAME_MS } from './logo'
import { LogOverlay } from './overlay'
import { RequestOverlay } from './request-overlay'
import { RequestLog } from './requests'
import { RouteOverlay } from './route-overlay'
import { beginDevUI } from './session'

export interface DevUIController {
  /** Whether the interactive UI is active (rather than the plain fallback). */
  interactive: boolean
  setStatus: (status: DevStatus, note?: string) => void
  /** Record a structured log event forwarded from the dev server fork. */
  pushServerLog: (log: { level: number, logType: string, tag?: string, message: string, origin?: 'build' | 'runtime', request?: string, requestId?: number }) => void
  /** Record a batch of served requests for the traffic ticker. */
  pushRequests: (requests: Array<{ id?: number, method: string, url: string, status: number, duration: number, internal?: boolean }>) => void
  /** Replace the routes shown in the route view. */
  setRoutes: (routes: DevRoutes) => void
}

export { beginDevUI } from './session'

const NOOP_CONTROLLER: DevUIController = { interactive: false, setStatus: () => {}, pushServerLog: () => {}, pushRequests: () => {}, setRoutes: () => {} }

/** How often the traffic ticker may repaint, so bursts cannot strobe the panel. */
const TICKER_REPAINT_MS = 250

/** How long the mark keeps traffic colour after a request. */
const ACTIVITY_MS = 700

/** How long passing feedback stays on the panel before it is dropped. */
const NOTICE_MS = 4000

const URL_STYLES = { local: 'cyan', network: 'magenta', tunnel: 'cyan', public: 'magenta' } as const

const URL_LABELS = { local: 'Local', network: 'Network', tunnel: 'Tunnel', public: 'Public' } as const

interface UIShortcut {
  keys: string[]
  /** Short label for the hint line. Omitted shortcuts live only in the help view. */
  hint?: string
  /** Higher survives longer as the hint line narrows. */
  priority?: number
  /** The key that does the same thing when held with control. */
  ctrl?: string
  /**
   * Match this exact key sequence rather than the key name, for shifted
   * letters that would otherwise be indistinguishable from their lowercase
   * shortcut.
   */
  sequence?: string
  description: string
  action: () => void
}

export interface DevUIOptions extends DevUISupportOptions {
  enabled?: boolean
  version?: string
  cwd?: string
  /** When the command started, so the panel can report a time to ready. */
  startTime?: number
}

/**
 * Interactive dev UI: a pinned status panel, folded-away logs and single-key
 * shortcuts, falling back to the line-based shortcuts whenever the terminal
 * cannot support it (pipes, CI, `--no-tui`).
 */
export function setupDevUI(context: ShortcutContext, options: DevUIOptions = {}): DevUIController {
  const session = options.enabled === false ? undefined : beginDevUI(options)
  if (!session) {
    setupShortcuts(context)
    return NOOP_CONTROLLER
  }

  const sessionStart = Date.now()
  session.stopStartupTicker()
  const { surface, events, state, surfaceText, render } = session
  const requests = new RequestLog()
  Object.assign(state, { version: options.version, versionLink: options.version ? linkVersion(options.version) : undefined })

  const write = (chunk: string) => surface.writeRaw(chunk)
  const release = () => surface.release()
  const cwd = options.cwd || process.cwd()
  /** Once the history has been read the counts have served their purpose. */
  function acknowledgeLogs(): void {
    update({ warnings: 0, errors: 0 })
  }
  const overlay = new LogOverlay(events, write, () => {
    acknowledgeLogs()
    release()
  })
  const routeOverlay = new RouteOverlay(write, release, cwd)
  const trafficOverlay = new RequestOverlay(requests, write, release, {
    resolveFile: request => request.status >= 400
      ? routeOverlay.errorComponent
      : routeOverlay.fileFor(request.url),
    cwd,
    events,
  })
  let shortcuts: UIShortcut[] = []
  let qrCode: string | undefined
  const helpOverlay = new HelpOverlay(() => shortcuts, write, release)
  const infoOverlay = new InfoOverlay(
    () => describeSession(context, cwd, requests, sessionStart, state.update, state.updateLink),
    write,
    release,
    () => qrCode,
  )
  const views = [overlay, trafficOverlay, routeOverlay, helpOverlay, infoOverlay]
  const openOverlay = () => views.find(view => view.isOpen)

  let animation: NodeJS.Timeout | undefined
  let activityTimer: NodeJS.Timeout | undefined
  let noticeTimer: NodeJS.Timeout | undefined

  function update(patch: Partial<PanelState>): void {
    Object.assign(state, patch)
    state.lastRequest = requests.last()
    state.requests = requests.total || undefined
    state.medianMs = requests.total ? requests.medianDuration() : undefined
    syncAnimation()
    render()
  }

  function refresh(): void {
    update({})
  }

  function clearActivity(): void {
    update({ active: false })
  }

  function advanceFrame(): void {
    const working = state.status !== 'ready' && state.status !== 'error'
    update({
      frame: (state.frame ?? 0) + 1,
      elapsedMs: working ? Date.now() - (state.loadStartedAt ?? sessionStart) : state.elapsedMs,
    })
  }

  /** Animate the mark only while the server is working and on screen. */
  function syncAnimation(): void {
    const working = state.status !== 'ready' && state.status !== 'error' && !openOverlay()
    if (working && !animation) {
      animation = setInterval(advanceFrame, LOGO_FRAME_MS)
      animation.unref?.()
    }
    else if (!working && animation) {
      clearInterval(animation)
      animation = undefined
    }
  }

  function clearNotice(): void {
    update({ notice: undefined })
  }

  /** Show `text` for a moment. Nothing a notice reports outlives the moment. */
  function showNotice(text: string, tone: 'info' | 'warn' | 'success'): void {
    clearTimeout(noticeTimer)
    update({ notice: { text: text.split('\n')[0]!.trim(), tone } })
    noticeTimer = setTimeout(clearNotice, NOTICE_MS)
    noticeTimer.unref?.()
  }

  const repaintTicker = createTickerRepainter(refresh)

  /** Drop the session's history: log events, the request table and the counts. */
  function clearHistory(): void {
    events.clear()
    requests.clear()
    // With the history gone, the error badge would point at nothing.
    update({ failures: 0, ...state.status === 'error' ? { status: 'ready' as DevStatus, note: undefined } : {} })
  }

  events.onClear(() => acknowledgeLogs())

  events.onEvent((event, merged) => {
    // A merge is another report of something already counted, not news.
    if (merged) {
      return
    }
    if (event.level <= 0) {
      update({ errors: (state.errors ?? 0) + 1, status: state.status === 'ready' ? 'error' : state.status })
    }
    else if (event.level === 1) {
      // A warning about what the CLI could not do says nothing about the app, so
      // it is shown once rather than counted against the build.
      if (event.source === 'cli') {
        showNotice(event.message, 'warn')
      }
      else {
        update({ warnings: (state.warnings ?? 0) + 1 })
      }
    }
  })

  context.onReady(() => {
    update({
      status: 'ready',
      note: undefined,
      progress: undefined,
      readyMs: state.readyMs ?? startupElapsedMs(options.startTime ?? sessionStart),
      urls: describeURLs(context),
    })
    void resolveQRCode(context).then((code) => {
      qrCode = code
    })
  })

  void resolveUpdate(options.version).then((latest) => {
    if (!latest) {
      return
    }
    const notes = releaseNotesUrl('nuxt', latest)
    const label = `\u2192 ${latest}`
    update({ update: latest, updateLink: notes ? terminalLink(label, notes) : label })
  })

  const quit = () => {
    session.teardown({ keep: true })
    process.emit('SIGINT' as any)
  }

  const restart = async (options: { clearCache?: boolean } = {}) => {
    if (!context.restart) {
      return
    }
    update({ status: 'restarting', note: options.clearCache ? 'clearing caches and restarting' : undefined })
    try {
      if (options.clearCache) {
        const cleared = await context.clearCaches?.()
        if (cleared?.length) {
          surfaceText(`${styleText('green', 'cleared')} ${styleText('dim', cleared.join(', '))}`)
        }
      }
      await context.restart()
    }
    finally {
      update({ status: 'ready' })
    }
  }

  // Dispatch and the help view are both driven from here, so they cannot drift.
  shortcuts = [
    { keys: ['r'], ctrl: 'r', hint: 'restart', priority: 80, description: 'restart the dev server', action: () => void restart() },
    { keys: ['R'], sequence: 'R', description: 'restart with a cleared cache', action: () => void restart({ clearCache: true }) },
    { keys: ['o'], hint: 'open', priority: 40, description: 'open in browser', action: () => void openBrowser(context.listener.url) },
    { keys: ['y'], description: 'copy the server URL to the clipboard', action: () => void copyURL(context, showNotice) },
    { keys: ['c'], ctrl: 'l', description: 'clear logs, requests and the console', action: () => {
      clearHistory()
      clearConsole(surface)
    } },
    { keys: ['e'], description: 'open the logs at the last error', action: () => {
      surface.hold()
      overlay.openAtLastError()
    } },
    { keys: ['i', 'u'], hint: 'info', priority: 50, description: 'show versions, URLs, QR code and session info', action: () => openView(infoOverlay) },
    { keys: ['l'], hint: 'logs', priority: 70, description: 'browse the log history', action: () => openView(overlay) },
    { keys: ['n'], hint: 'network', priority: 60, description: 'browse served requests', action: () => openView(trafficOverlay) },
    { keys: ['p'], hint: 'routes', priority: 30, description: 'browse pages and server routes', action: () => openView(routeOverlay) },
    { keys: ['?', 'h'], hint: 'help', priority: 100, description: 'show this help', action: () => openView(helpOverlay) },
    // A quit is only confirmed while something is in flight; when idle it takes
    // effect at once, as in every other tool.
    { keys: ['q'], ctrl: 'd', hint: 'quit', priority: 90, description: 'quit', action: () => state.status === 'ready' ? quit() : update({ confirmQuit: true }) },
  ]

  update({
    hints: shortcuts
      .filter((shortcut): shortcut is UIShortcut & { hint: string, priority: number } => !!shortcut.hint)
      .map(({ keys, hint, priority }) => ({ key: keys[0]!, label: hint, priority })),
    hintsDimmed: false,
  })

  function openView(view: { open: () => void }): void {
    surface.hold()
    view.open()
  }

  const onKey = (key: Key) => {
    const active = openOverlay()
    if (key.ctrl && key.name === 'c') {
      active?.close()
      return quit()
    }

    // Works inside every view too: the views render from the same history.
    if (key.ctrl && key.name === 'l') {
      clearHistory()
      if (active) {
        return active.repaint()
      }
      return clearConsole(surface)
    }

    if (active) {
      return active.handleKey(key)
    }

    if (state.confirmQuit && !key.ctrl) {
      return key.name === 'y' ? quit() : update({ confirmQuit: false })
    }

    // Punctuation keys arrive with a sequence and no name, so both are matched.
    const shortcut = shortcuts.find(({ sequence }) => sequence && sequence === key.sequence)
      ?? shortcuts.find(({ keys, ctrl, sequence }) => !sequence && (key.ctrl
        ? ctrl === key.name
        : (!!key.name && keys.includes(key.name)) || (!!key.sequence && keys.includes(key.sequence))))
    void shortcut?.action()
  }

  const detach = attachKeys(onKey)
  session.onTeardown(() => {
    clearInterval(animation)
    clearTimeout(activityTimer)
    clearTimeout(noticeTimer)
    animation = undefined
    detach()
    openOverlay()?.close()
  })

  refresh()

  return {
    interactive: true,
    setStatus: (status, note) => {
      // The counts only describe what is currently wrong, so a successful load
      // supersedes earlier build errors.
      if (status === 'ready') {
        update({ status, note: undefined, progress: undefined, errors: 0, warnings: 0, failures: 0 })
        return
      }
      // Entering a working state restarts the clock, and drops any progress
      // fraction: only a full load reports one, and a stale bar would lie.
      const restarted = state.status === 'ready' || state.status === 'error'
      update({ status, note, ...restarted ? { loadStartedAt: Date.now(), elapsedMs: 0, progress: undefined } : {} })
    },
    pushServerLog: (log) => {
      session.expectRender(events.push({
        time: Date.now(),
        level: log.level,
        type: log.logType,
        tag: log.tag,
        message: log.message,
        request: log.request,
        requestId: log.requestId,
        source: log.origin ?? 'build',
      }, { absorb: true }))
    },
    pushRequests: (batch) => {
      if (!batch.length) {
        return
      }
      requests.push(batch.map(request => ({ time: Date.now(), ...request })))
      const failed = batch.filter(request => request.status >= 500)
      // Nuxt answers a failed render with its error page rather than logging it,
      // so the response status is the only signal that something is wrong.
      const failing = (batch.at(-1)?.status ?? 0) >= 500
      update({
        active: true,
        failures: (state.failures ?? 0) + failed.length,
        status: failing
          ? 'error'
          : state.status === 'error' && !state.errors ? 'ready' : state.status,
        note: failing ? 'a request failed · press n to trace it' : state.note,
      })
      repaintTicker()
      clearTimeout(activityTimer)
      activityTimer = setTimeout(clearActivity, ACTIVITY_MS)
      activityTimer.unref?.()
    },
    setRoutes: payload => routeOverlay.setRoutes(payload),
  }
}

/**
 * Repaint at most once per {@link TICKER_REPAINT_MS}, with a trailing repaint so
 * the last request of a burst is always the one left on screen.
 */
function createTickerRepainter(render: () => void): () => void {
  let last = 0
  let timer: NodeJS.Timeout | undefined
  return () => {
    if (timer) {
      return
    }
    const wait = Math.max(0, TICKER_REPAINT_MS - (Date.now() - last))
    timer = setTimeout(() => {
      timer = undefined
      last = Date.now()
      render()
    }, wait)
    timer.unref?.()
  }
}

function clearConsole(surface: PanelSurface): void {
  void withDirectStdout(() => process.stdout.write('\u001B[2J\u001B[3J\u001B[H'))
    .then(() => {
      surface.resetRows()
      surface.padToBottom()
    })
}

async function copyURL(context: ShortcutContext, notify: (text: string, tone: 'info' | 'warn' | 'success') => void): Promise<void> {
  const url = context.listener.publicURL || context.listener.url
  try {
    const { writeText } = await import('tinyclip')
    await writeText(url)
    notify(`copied ${url} to the clipboard`, 'success')
  }
  catch {
    notify('no clipboard available', 'warn')
  }
}

/** Listener URLs as panel entries, shared with the pre-ready pending block. */
export function describeListenURLs(urls: Array<{ type: keyof typeof URL_LABELS, url: string }>, options: { pending?: boolean } = {}): PanelURL[] {
  return urls.map(({ type, url }) => ({
    label: URL_LABELS[type] ?? type,
    url,
    link: terminalLink(url, url),
    style: URL_STYLES[type],
    pending: options.pending,
  }))
}

/** The URL block, in the order a user is most likely to want them. */
function describeURLs(context: ShortcutContext): PanelURL[] {
  const { listener } = context
  const urls: PanelURL[] = describeListenURLs(listener.getURLs())
  if (listener.publicURL && !urls.some(entry => entry.url === listener.publicURL)) {
    urls.push({ label: URL_LABELS.public, url: listener.publicURL, link: terminalLink(listener.publicURL, listener.publicURL), style: URL_STYLES.public })
  }
  return urls
}

/** The sections shown by the info view, gathered when it is opened. */
function describeSession(
  context: ShortcutContext,
  cwd: string,
  requests: RequestLog,
  sessionStart: number,
  update?: string,
  updateLink?: string,
): InfoSection[] {
  const versions = resolveStackVersions(cwd)
  const { listener } = context

  return [
    {
      heading: 'versions',
      entries: [
        ['Nuxt', update
          ? `${linkVersion(versions.nuxt)} ${styleText('yellow', updateLink ?? `\u2192 ${update} available`)}`
          : linkVersion(versions.nuxt)],
        ['Nitro', versions.nitro],
        [versions.builder.name, versions.builder.version],
        [versions.builder.provider?.name ?? 'via', versions.builder.provider?.version],
        ['Vue', versions.vue ?? undefined],
        ['Node', process.version.replace(/^v/, '')],
      ],
    },
    {
      heading: 'urls',
      entries: [
        ...listener.getURLs().map(({ type, url }) => [type, url, URL_STYLES[type]] as InfoSection['entries'][number]),
        ['public', listener.publicURL, URL_STYLES.public],
      ],
    },
    {
      heading: 'session',
      entries: [
        ['uptime', formatUptime(Date.now() - sessionStart)],
        ['requests', String(requests.total)],
        ['median', requests.total ? `${requests.medianDuration()}ms` : undefined],
        ['directory', cwd],
      ],
    },
  ]
}

/** A version, linked to its release notes where the terminal supports it. */
function linkVersion(version: string): string {
  const notes = releaseNotesUrl('nuxt', version)
  return notes ? terminalLink(version, notes) : version
}

/** A QR code for whichever URL another device could reach, if any. */
async function resolveQRCode(context: ShortcutContext): Promise<string | undefined> {
  const url = context.listener.qrURL
    || context.listener.getURLs().find(({ type }) => type !== 'local')?.url
  if (!url) {
    return undefined
  }
  const { renderUnicodeCompact } = await import('uqr')
  return renderUnicodeCompact(url)
}

/** The newer Nuxt release, if the registry knows of one and checks are enabled. */
async function resolveUpdate(current?: string): Promise<string | undefined> {
  if (!current || !isUpdateCheckEnabled()) {
    return undefined
  }
  try {
    const update = await checkForUpdate('nuxt', current)
    return update?.latest
  }
  catch {
    // An unreachable registry must never disturb the session.
    return undefined
  }
}

function formatUptime(elapsed: number): string {
  const seconds = Math.floor(elapsed / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [...hours ? [`${hours}h`] : [], ...hours || minutes ? [`${minutes}m`] : [], `${seconds % 60}s`].join(' ')
}
