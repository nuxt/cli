import type { TerminalNotification } from '../../utils/terminal-host'
import type { ShortcutContext } from '../shortcuts'
import type { DevUIController } from './controller'
import type { InfoSection } from './info-overlay'
import type { Key } from './keys'
import type { DevStatus, PanelState, PanelURL } from './panel'

import type { DevUISupportOptions } from './support'
import type { PanelSurface } from './surface'

import { AsyncLocalStorage } from 'node:async_hooks'
import process from 'node:process'

import { styleText } from 'node:util'
import { resolveStackVersions } from '../../utils/banner'
import { withDirectStdout } from '../../utils/console'
import { startupElapsedMs } from '../../utils/startup-clock'

import { registerTerminalHost } from '../../utils/terminal-host'
import { terminalLink } from '../../utils/terminal-link'
import { MUTED, paint } from '../../utils/terminal-theme'
import { checkForUpdate, isUpdateCheckEnabled, releaseNotesUrl } from '../../utils/update-check'
import { openBrowser } from '../listen'
import { setupShortcuts } from '../shortcuts'
import { NOOP_CONTROLLER } from './controller'
import { isBoxedNotice, normaliseMessage } from './events'
import { HelpOverlay } from './help-overlay'
import { InfoOverlay } from './info-overlay'
import { attachKeys } from './keys'
import { LOGO_FRAME_MS } from './logo'
import { LogOverlay } from './overlay'
import { describeListenURLs, URL_LABELS, URL_STYLES } from './panel'
import { RequestOverlay } from './request-overlay'
import { RequestLog } from './requests'
import { RouteOverlay } from './route-overlay'
import { beginDevUI } from './session'

export { beginDevUI } from './session'
export type { DevUIController }

/** How often the traffic ticker may repaint, so bursts cannot strobe the panel. */
const TICKER_REPAINT_MS = 250

/** Frames the mark skips per painted one while waiting for the first render. */
const WARMUP_FRAME_RATIO = 4

/** How long the mark keeps traffic colour after a request. */
const ACTIVITY_MS = 700

/** How long passing feedback stays on the panel before it is dropped. */
const NOTICE_MS = 4000

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
  const version = options.version ?? state.version
  Object.assign(state, { version, versionLink: version ? linkVersion(version) : undefined })

  const write = (chunk: string) => surface.writeRaw(chunk)
  const release = () => {
    surface.screenMode = 'split-footer'
  }
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
  let animationInterval = LOGO_FRAME_MS
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

  // Progress writes the panel state itself; going through `update` is what arms
  // the animation for whatever it has just put there.
  session.onProgressChange(refresh)

  function clearActivity(): void {
    update({ active: false })
  }

  function advanceFrame(): void {
    const working = state.status !== 'ready' && state.status !== 'error'
    update({
      frame: (state.frame ?? 0) + 1,
      elapsedMs: working ? Date.now() - (state.loadStartedAt ?? sessionStart) : state.elapsedMs,
      phaseElapsedMs: working && state.phaseStartedAt !== undefined ? Date.now() - state.phaseStartedAt : state.phaseElapsedMs,
      renderingMs: state.rendering && Date.now() - state.rendering.startedAt,
    })
  }

  /**
   * Animate the mark only while something is in flight, on screen. A request
   * being rendered counts: the server is not loading, but it is the only thing
   * happening, and a still panel in front of a slow page reads as a hung one.
   */
  function syncAnimation(): void {
    const busy = (state.status !== 'ready' && state.status !== 'error') || !!state.task || !!state.rendering
    const working = busy && !openOverlay()
    // Waiting on a render is measured in seconds, sometimes tens of them, which
    // is too long to spend a build's frame rate on: the panel only has to look
    // alive.
    const interval = state.status === 'warming' || state.rendering ? LOGO_FRAME_MS * WARMUP_FRAME_RATIO : LOGO_FRAME_MS
    if (working && animation && interval !== animationInterval) {
      clearInterval(animation)
      animation = undefined
    }
    if (working && !animation) {
      animationInterval = interval
      animation = setInterval(advanceFrame, interval)
      animation.unref?.()
    }
    else if (!working && animation) {
      clearInterval(animation)
      animation = undefined
    }
  }

  /** A message held on the status line until the user has seen it. */
  interface HeldNotice {
    text: string
    tone: 'info' | 'warn'
    /** Replaces the status badge, for something that is waiting on the user. */
    label?: string
    resolve: () => void
  }

  /** Notices not yet acknowledged, oldest first; the line shows the newest. */
  const heldNotices: HeldNotice[] = []

  function clearNotice(): void {
    const held = heldNotices.at(-1)
    update({ notice: held ? { text: held.text, tone: held.tone, label: held.label } : undefined })
  }

  function dismissHeld(held: HeldNotice): void {
    const index = heldNotices.indexOf(held)
    if (index === -1) {
      return
    }
    heldNotices.splice(index, 1)
    held.resolve()
    clearNotice()
  }

  /**
   * Hold a message on the status line until the user acknowledges it with a
   * keypress or the caller lets it go.
   *
   * The single path for anything that must not scroll away unnoticed, whether
   * it was reported through the terminal host or recovered from a box a tool
   * printed without knowing about the host.
   */
  function holdNotice(notice: { text: string, tone: 'info' | 'warn', label?: string }) {
    let resolve!: () => void
    const dismissed = new Promise<void>((settle) => {
      resolve = settle
    })
    const held: HeldNotice = { ...notice, text: notice.text.split('\n')[0]!.trim(), resolve }
    heldNotices.push(held)
    clearTimeout(noticeTimer)
    clearNotice()
    return { dismiss: () => dismissHeld(held), dismissed }
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
    if (isBoxedNotice(event)) {
      // The box itself is written above the panel, where its URL can be read and
      // copied; the badge is what stops it scrolling away unnoticed.
      holdNotice({ text: firstSentence(event.message), tone: 'warn', label: 'ACTION' })
      return
    }
    if (event.level <= 0) {
      update({ errors: (state.errors ?? 0) + 1, status: state.status === 'ready' ? 'error' : state.status })
    }
    else if (event.level === 1) {
      // A warning about what the CLI could not do says nothing about the app, so
      // it is shown once rather than counted against the build.
      if (event.source === 'cli') {
        // One raised while starting up describes the session itself, not a
        // moment in it: how the server is exposed, what could not be set up.
        // Those are worth holding until someone has looked at the panel.
        if (state.readyMs === undefined) {
          holdNotice({ text: firstSentence(event.message), tone: 'warn', label: 'WARNING' })
        }
        else {
          showNotice(event.message, 'warn')
        }
      }
      else {
        update({ warnings: (state.warnings ?? 0) + 1 })
      }
    }
  })

  context.onReady(() => {
    // Whether anything is still being waited for is progress's to say: a ready
    // listener only knows the socket is up, and a server nobody has asked for a
    // page yet is not warming up, it is idle.
    const warming = state.status === 'warming'
    update({
      status: warming ? 'warming' : 'ready',
      note: warming ? state.note : undefined,
      progress: warming ? state.progress : undefined,
      readyMs: state.readyMs ?? startupElapsedMs(options.startTime ?? sessionStart),
      urls: describeURLs(context),
    })
    void resolveQRCode(context).then((code) => {
      qrCode = code
    })
  })

  void resolveUpdate(version).then((latest) => {
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
          surfaceText(`${styleText('green', 'cleared')} ${styleText(MUTED, cleared.join(', '))}`)
        }
      }
      await context.restart()
    }
    catch (error) {
      // A restart that throws must not take the session with it: both call
      // sites dispatch it from a keypress, where nothing is awaiting.
      showNotice(`could not restart: ${error instanceof Error ? error.message : error}`, 'warn')
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
      surface.screenMode = 'alternate-screen'
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
    surface.screenMode = 'alternate-screen'
    view.open()
  }

  const onKey = (key: Key) => {
    const active = openOverlay()
    // Any keypress is proof the panel is being watched, so a held notice has
    // done its work. The key still does whatever it would have done.
    for (const held of [...heldNotices]) {
      dismissHeld(held)
    }
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

  let detach = attachKeys(onKey)

  /** Set at teardown, so a borrow that outlives the session cannot restore it. */
  let torn = false

  /**
   * Give borrowed work the terminal for as long as it needs it.
   *
   * The panel and the shortcuts both have to let go: the panel because it
   * paints over the rows the work draws on, and the shortcuts because they
   * hold stdin in raw mode and would answer the keystrokes meant for it.
   */
  async function lendTerminal<T>(work: () => Promise<T>): Promise<T> {
    openOverlay()?.close()
    detach()
    const resume = surface.suspend()
    try {
      return await work()
    }
    finally {
      resume()
      // A session torn down mid-borrow (Ctrl-C answered a prompt) has already
      // detached and given the terminal back; re-attaching would put stdin
      // into raw mode with nothing listening and keep the process alive.
      if (!torn) {
        detach = attachKeys(onKey)
        render()
      }
    }
  }

  /** Settles when the terminal is free again, so borrowers take turns. */
  let terminalQueue: Promise<unknown> = Promise.resolve()

  /** Set inside a borrow, so a nested borrow can be told from a rival one. */
  const borrowScope = new AsyncLocalStorage<boolean>()

  /** Work reported through the host, most recent last; the panel shows the last. */
  const tasks: Array<{ label: string, startedAt: number }> = []

  function syncTasks(): void {
    update({ task: tasks.at(-1) })
  }

  const releaseHost = registerTerminalHost({
    version: 1,
    withTerminal: <T>(work: () => Promise<T>): Promise<T> => {
      // A borrower that asks again mid-borrow already has the terminal: kit
      // lends it to a prompt whose consola implementation routes back through
      // here, and queueing that behind itself would deadlock. A rival caller
      // is not in the scope and still waits its turn.
      if (borrowScope.getStore()) {
        return work()
      }
      const result = terminalQueue.then(() => lendTerminal(() => borrowScope.run(true, work)))
      terminalQueue = result.catch(() => {})
      return result
    },
    notify: (notification) => {
      // The full text goes into scrollback where it can be read and copied,
      // and into the history; the held notice is what stops it scrolling away
      // unnoticed.
      surfaceText(renderNotification(notification))
      events.push({
        time: Date.now(),
        level: 3,
        type: 'info',
        message: [notification.title, notification.message].filter(Boolean).join('\n'),
        source: 'cli',
      })
      return holdNotice({
        text: notification.title ?? notification.message,
        tone: notification.level === 'warn' ? 'warn' : 'info',
      })
    },
    startTask: (label) => {
      const task = { label, startedAt: Date.now() }
      tasks.push(task)
      syncTasks()
      return {
        update: (text) => {
          task.label = text
          syncTasks()
        },
        stop: (message, outcome) => {
          const index = tasks.indexOf(task)
          if (index !== -1) {
            tasks.splice(index, 1)
          }
          syncTasks()
          if (!message) {
            return
          }
          // The outcome goes two places: feedback on the panel now, and the
          // history, which is where the line a spinner leaves behind survives.
          showNotice(message, outcome === 'failure' ? 'warn' : 'success')
          events.push({
            time: Date.now(),
            level: outcome === 'failure' ? 0 : 3,
            type: outcome === 'failure' ? 'error' : 'success',
            message,
            source: 'cli',
          })
        },
      }
    },
  })
  session.onTeardown(() => {
    torn = true
    clearInterval(animation)
    clearTimeout(activityTimer)
    clearTimeout(noticeTimer)
    animation = undefined
    releaseHost()
    // Nothing can be acknowledged on a torn-down panel, and a caller may be
    // awaiting the dismissal.
    for (const held of [...heldNotices]) {
      dismissHeld(held)
    }
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
        update({ status, note: undefined, progress: undefined, phaseStartedAt: undefined, phaseElapsedMs: undefined, errors: 0, warnings: 0, failures: 0 })
        return
      }
      // Entering a working state restarts the clock, and drops any progress
      // fraction: only a full load reports one, and a stale bar would lie.
      const restarted = state.status === 'ready' || state.status === 'error'
      update({ status, note, ...restarted ? { loadStartedAt: Date.now(), elapsedMs: 0, progress: undefined, phaseStartedAt: undefined, phaseElapsedMs: undefined } : {} })
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
      // The bundler's own probes 503 while a restart is in flight
      const app = batch.filter(request => !request.internal)
      const failed = app.filter(request => request.status >= 500)
      // Nuxt answers a failed render with its error page rather than logging it,
      // so the response status is the only signal that something is wrong.
      const failing = (app.at(-1)?.status ?? 0) >= 500
      const recovered = app.length > 0 && !failing && state.status === 'error' && !state.errors
      update({
        active: true,
        failures: (state.failures ?? 0) + failed.length,
        status: failing ? 'error' : recovered ? 'ready' : state.status,
        note: failing ? 'a request failed · press n to trace it' : recovered ? undefined : state.note,
      })
      repaintTicker()
      clearTimeout(activityTimer)
      activityTimer = setTimeout(clearActivity, ACTIVITY_MS)
      activityTimer.unref?.()
    },
    setRoutes: payload => routeOverlay.setRoutes(payload),
    setRendering: (pending, awaiting) => {
      update({
        rendering: pending && { label: pending.label, startedAt: pending.startedAt },
        renderingMs: pending && Date.now() - pending.startedAt,
        ...awaiting === undefined ? {} : { awaitingFirstRender: awaiting },
      })
    },
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
          ? `${linkVersion(versions.nuxt)} ${paint('warning', updateLink ?? `\u2192 ${update} available`)}`
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

/** The gist of a message, for a status line that has one line to say it in. */
function firstSentence(message: string): string {
  return normaliseMessage(message).split('. ')[0]!
}

/** A notification as it belongs in scrollback: legible, copyable, unboxed. */
function renderNotification({ title, message, level }: TerminalNotification): string {
  const mark = level === 'warn' ? styleText(['yellow', 'bold'], '\u26A0') : styleText('cyan', '\u2139')
  const head = title ? `${mark} ${styleText('bold', title)}\n` : ''
  return `${head}${message}`
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
