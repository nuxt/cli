import type { TerminalNotification } from '../../utils/terminal-host'
import type { ShortcutContext } from '../shortcuts'
import type { DevUIController } from './controller'
import type { PanelStart } from './first-frame'
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
import { formatDuration, terminalLink } from '../../utils/formatting'
import { releaseNotesUrl } from '../../utils/release-notes'
import { startupElapsedMs } from '../../utils/startup-clock'

import { registerTerminalHost } from '../../utils/terminal-host'
import { MUTED, paint } from '../../utils/terminal-theme'
import { openBrowser, writeClipboard } from '../listen'
import { setupShortcuts } from '../shortcuts'
import { isShutdownAdopted } from '../shutdown'
import { NOOP_CONTROLLER } from './controller'
import { isBoxedNotice, normaliseMessage } from './events'
import { HelpOverlay } from './help-overlay'
import { InfoOverlay } from './info-overlay'
import { attachKeys } from './keys'
import { LOGO_FRAME_MS } from './logo'
import { LogOverlay } from './overlay'
import { describeListenURLs, URL_LABELS, URL_STYLES } from './panel'
import { readProjectReport } from './project-report'
import { RequestOverlay } from './request-overlay'
import { RequestLog } from './requests'
import { RouteOverlay } from './route-overlay'
import { beginDevUI } from './session'

export { beginDevUI } from './session'
export type { DevUIController }

const attached = new WeakMap<object, DevUIController>()

const TICKER_REPAINT_MS = 250

const WARMUP_FRAME_RATIO = 4

const ACTIVITY_MS = 700

const NOTICE_MS = 4000

const LOADING_STATUSES = new Set<DevStatus>(['starting', 'building', 'restarting'])

interface UIShortcut {
  keys: string[]
  /** Short label for the hint line. Omitted shortcuts live only in the help view. */
  hint?: string
  /** Higher survives longer as the hint line narrows. */
  priority?: number
  ctrl?: string
  isAvailable?: () => boolean
  /** Exact sequence, including case. */
  sequence?: string
  description: string
  isArmed?: () => boolean
  action: () => void
}

export interface DevUIOptions extends DevUISupportOptions {
  enabled?: boolean
  version?: string
  cwd?: string
  /** When the command started, so the panel can report a time to ready. */
  startTime?: number
  /** A frame already on screen, for the session to adopt. */
  start?: PanelStart
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
  if (attached.has(session)) {
    return attached.get(session)!
  }

  const sessionStart = Date.now()
  session.stopStartupTicker()
  session.onTeardown(() => attached.delete(session))
  const { surface, events, state, surfaceText, render } = session
  const requests = new RequestLog()
  const version = options.version ?? state.version
  Object.assign(state, { version, versionLink: version ? linkVersion(version) : undefined })

  const write = (chunk: string) => surface.writeRaw(chunk)
  const release = () => {
    surface.screenMode = 'split-footer'
  }
  const cwd = options.cwd || process.cwd()
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
  let armedOpen = false
  const helpOverlay = new HelpOverlay(() => shortcuts.filter(shortcut => shortcut.isAvailable?.() !== false), write, release)
  const infoOverlay = new InfoOverlay(
    () => describeSession(context, cwd, requests, sessionStart, state.update, state.updateLink),
    write,
    release,
    () => qrCode,
    () => readProjectReport(cwd),
  )
  const views = [overlay, trafficOverlay, routeOverlay, helpOverlay, infoOverlay]
  const openOverlay = () => views.find(view => view.isOpen)

  let animation: NodeJS.Timeout | undefined
  let animationInterval = LOGO_FRAME_MS
  let activityTimer: NodeJS.Timeout | undefined
  let reported: string | undefined
  let noticeTimer: NodeJS.Timeout | undefined
  let loadFailed = false

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

  session.onProgressChange(refresh)

  function advanceFrame(): void {
    const working = state.status !== 'ready' && state.status !== 'error'
    update({
      frame: (state.frame ?? 0) + 1,
      elapsedMs: working ? Date.now() - (state.loadStartedAt ?? sessionStart) : state.elapsedMs,
      phaseElapsedMs: working && state.phaseStartedAt !== undefined ? Date.now() - state.phaseStartedAt : state.phaseElapsedMs,
      renderingMs: state.rendering && Date.now() - state.rendering.startedAt,
    })
  }

  function syncAnimation(): void {
    const busy = (state.status !== 'ready' && state.status !== 'error') || !!state.task || !!state.rendering
    const working = busy && !openOverlay()
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

  interface HeldNotice {
    text: string
    tone: 'info' | 'warn'
    label?: string
    resolve: () => void
  }

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

  function showNotice(text: string, tone: 'info' | 'warn' | 'success'): void {
    clearTimeout(noticeTimer)
    update({ notice: { text: text.split('\n')[0]!.trim(), tone } })
    noticeTimer = setTimeout(clearNotice, NOTICE_MS)
    noticeTimer.unref?.()
  }

  function clearActivity(): void {
    update({ active: false })
  }

  const repaintTicker = createTickerRepainter(refresh)

  function clearHistory(): void {
    events.clear()
    requests.clear()
    loadFailed = false
    update({ failures: 0, ...state.status === 'error' ? { status: 'ready' as DevStatus, note: undefined } : {} })
  }

  events.onClear(() => acknowledgeLogs())

  events.onEvent((event, merged) => {
    if (merged) {
      return
    }
    if (isBoxedNotice(event)) {
      holdNotice({ text: firstSentence(event.message), tone: 'warn', label: 'ACTION' })
      return
    }
    if (event.level <= 0) {
      loadFailed ||= LOADING_STATUSES.has(state.status)
      update({
        errors: (state.errors ?? 0) + 1,
        status: 'error',
        ...state.status === 'error' ? {} : { note: undefined },
      })
    }
    else if (event.level === 1) {
      if (event.source === 'cli') {
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
    if (armedOpen && context.listener) {
      armedOpen = false
      openBrowser(context.listener.url)
      syncHints()
    }
    const warming = state.status === 'warming'
    syncHints()
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

  const quit = (signal: 'SIGINT' | 'SIGQUIT' = 'SIGINT') => {
    session.teardown({ keep: true })
    if (!isShutdownAdopted()) {
      process.exit(signal === 'SIGQUIT' ? 131 : 130)
    }
    process.emit(signal as any)
  }

  const settleRestart = () => update({ status: loadFailed ? 'error' : 'ready', note: undefined })

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
      showNotice(`could not restart: ${error instanceof Error ? error.message : error}`, 'warn')
    }
    finally {
      if (state.status === 'restarting') {
        settleRestart()
      }
    }
  }

  shortcuts = [
    { keys: ['r'], isAvailable: () => !!context.restart, hint: 'restart', priority: 80, description: 'restart the dev server', action: () => void restart() },
    { keys: ['R'], sequence: 'R', isAvailable: () => !!context.restart && !!context.clearCaches, description: 'restart with a cleared cache', action: () => void restart({ clearCache: true }) },
    { keys: ['o'], hint: 'open', priority: 40, description: 'open in browser', isArmed: () => armedOpen, action: () => open() },
    { keys: ['y'], description: 'copy the server URL to the clipboard', action: () => void copyURL(context, showNotice) },
    { keys: ['c'], description: 'clear the console without deleting history', action: () => clearConsole(surface) },
    { keys: ['x'], description: 'delete log and request history', action: clearHistory },
    { keys: ['e'], description: 'open the logs at the last error', action: () => {
      surface.screenMode = 'alternate-screen'
      overlay.openAtLastError()
    } },
    { keys: ['i', 'u'], hint: 'info', priority: 50, description: 'show versions, URLs, QR code and session info', action: () => openView(infoOverlay) },
    { keys: ['l'], hint: 'logs', priority: 70, description: 'browse the log history', action: () => openView(overlay) },
    { keys: ['n'], hint: 'network', priority: 60, description: 'browse served requests', action: () => openView(trafficOverlay) },
    { keys: ['p'], hint: 'routes', priority: 30, description: 'browse pages and server routes', action: () => openView(routeOverlay) },
    { keys: ['?', 'h'], hint: 'help', priority: 100, description: 'show this help', action: () => openView(helpOverlay) },
    { keys: ['q'], hint: 'quit', priority: 90, description: 'quit', action: () => quit() },
    { keys: [], ctrl: 'c', description: 'quit (press again during cleanup to force exit)', action: () => quit() },
    { keys: [], ctrl: 'd', description: 'quit', action: () => quit() },
    { keys: [], ctrl: 'l', description: 'clear the console or redraw the current view', action: () => {
      const active = openOverlay()
      if (active) {
        active.repaint()
      }
      else {
        clearConsole(surface)
      }
    } },
    { keys: [], ctrl: 'r', isAvailable: () => !!context.restart, description: 'restart the dev server', action: () => {
      openOverlay()?.close()
      void restart()
    } },
    ...process.platform === 'win32'
      ? []
      : [
          { keys: [], ctrl: 'z', description: 'suspend (resume with fg)', action: () => suspend() },
          { keys: [], ctrl: '\\', description: 'quit with SIGQUIT', action: () => quit('SIGQUIT') },
        ],
  ]

  function open(): void {
    if (context.listener) {
      openBrowser(context.listener.url)
      return
    }
    armedOpen = !armedOpen
    syncHints()
  }

  function syncHints(): void {
    update({
      hints: shortcuts
        .filter((shortcut): shortcut is UIShortcut & { hint: string, priority: number } => !!shortcut.hint && shortcut.isAvailable?.() !== false)
        .map(({ keys, hint, priority, isArmed }) => ({
          key: keys[0]!,
          label: hint,
          priority,
          armed: isArmed?.(),
        })),
      hintsDimmed: false,
    })
  }

  syncHints()

  function openView(view: { open: () => void }): void {
    surface.screenMode = 'alternate-screen'
    view.open()
  }

  const onKey = (key: Key) => {
    const active = openOverlay()
    for (const held of [...heldNotices]) {
      dismissHeld(held)
    }
    if (key.meta) {
      return
    }
    if (key.ctrl) {
      const shortcut = shortcuts.find(shortcut => shortcut.ctrl === key.name)
      return shortcut?.action()
    }
    if (active) {
      return active.handleKey(key)
    }

    const shortcut = shortcuts.find(({ sequence }) => sequence && sequence === key.sequence)
      ?? shortcuts.find(({ keys, sequence }) => !sequence && (
        (!!key.name && !key.shift && keys.includes(key.name)) || (!!key.sequence && keys.includes(key.sequence))
      ))
    if (shortcut?.isAvailable?.() === false) {
      return showNotice('shortcut is not available yet', 'info')
    }
    void shortcut?.action()
  }

  let detach = attachKeys(onKey)

  let torn = false
  let resumeTerminal: (() => void) | undefined

  function suspend(): void {
    if (process.platform === 'win32' || torn || resumeTerminal) {
      return
    }
    openOverlay()?.close()
    detach()
    resumeTerminal = surface.suspend()
    process.kill(process.pid, 'SIGSTOP')
  }

  function onContinue(): void {
    if (!resumeTerminal) {
      return
    }
    resumeTerminal()
    resumeTerminal = undefined
    if (!torn) {
      detach = attachKeys(onKey, { ignoreBufferedInput: true })
      render()
    }
  }

  if (process.platform !== 'win32') {
    process.on('SIGTSTP', suspend)
    process.on('SIGCONT', onContinue)
  }

  async function lendTerminal<T>(work: () => Promise<T>): Promise<T> {
    openOverlay()?.close()
    detach()
    const resume = surface.suspend()
    try {
      return await work()
    }
    finally {
      resume()
      if (!torn) {
        detach = attachKeys(onKey, { ignoreBufferedInput: true })
        render()
      }
    }
  }

  let terminalQueue: Promise<unknown> = Promise.resolve()

  const borrowScope = new AsyncLocalStorage<boolean>()

  const tasks: Array<{ label: string, startedAt: number }> = []

  function syncTasks(): void {
    update({ task: tasks.at(-1) })
  }

  const releaseHost = registerTerminalHost({
    version: 1,
    withTerminal: <T>(work: () => Promise<T>): Promise<T> => {
      if (borrowScope.getStore()) {
        return work()
      }
      const result = terminalQueue.then(() => lendTerminal(() => borrowScope.run(true, work)))
      terminalQueue = result.catch(() => {})
      return result
    },
    notify: (notification) => {
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
    process.off('SIGTSTP', suspend)
    process.off('SIGCONT', onContinue)
    onContinue()
    clearInterval(animation)
    clearTimeout(activityTimer)
    clearTimeout(noticeTimer)
    animation = undefined
    releaseHost()
    for (const held of [...heldNotices]) {
      dismissHeld(held)
    }
    detach()
    openOverlay()?.close()
  })

  refresh()

  const controller: DevUIController = {
    interactive: true,
    settleRestart,
    setStatus: (status, note) => {
      if (status === 'ready') {
        loadFailed = false
        update({ status, note: undefined, progress: undefined, phaseStartedAt: undefined, phaseElapsedMs: undefined, errors: 0, warnings: 0, failures: 0 })
        return
      }
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
      }, { route: log.raw ? 'reporter' : 'report' }))
    },
    pushRequests: (batch) => {
      if (!batch.length) {
        return
      }
      requests.push(batch.map(request => ({ time: Date.now(), ...request })))
      const app = batch.filter(request => !request.internal)
      const failed = app.filter(request => request.status >= 500)
      const failing = (app.at(-1)?.status ?? 0) >= 500
      const recovered = app.length > 0 && !failing && state.status === 'error' && !loadFailed
      const failureNote = failing && !loadFailed ? 'a request failed · press n to trace it' : undefined
      update({
        active: true,
        failures: (state.failures ?? 0) + failed.length,
        status: failing ? 'error' : recovered ? 'ready' : state.status,
        note: failureNote ?? (recovered ? undefined : state.note),
      })
      repaintTicker()
      clearTimeout(activityTimer)
      activityTimer = setTimeout(clearActivity, ACTIVITY_MS)
      activityTimer.unref?.()
    },
    pushSpans: spans => requests.pushSpans(spans),
    pushReport: (report) => {
      reported = report.id
      update({ status: 'error', note: `${report.message} · press l to read it` })
      events.push({
        time: Date.now(),
        level: 0,
        type: 'error',
        message: report.ansi,
        rendered: report.ansi,
        styled: true,
        source: 'runtime',
        request: report.request,
        requestId: report.requestId,
      })
    },
    clearReport: (id) => {
      if (id !== undefined && id !== reported) {
        return
      }
      reported = undefined
      update({ note: undefined })
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

  attached.set(session, controller)
  return controller
}

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
  const url = context.listener?.publicURL || context.listener?.url
  if (!url) {
    notify('no server to copy the url of yet', 'warn')
    return
  }
  if (await writeClipboard(url)) {
    notify(`copied ${url} to the clipboard`, 'success')
  }
  else {
    notify('no clipboard available', 'warn')
  }
}

function describeURLs(context: ShortcutContext): PanelURL[] {
  const { listener } = context
  if (!listener) {
    return []
  }
  const urls: PanelURL[] = describeListenURLs(listener.getURLs())
  if (listener.publicURL && !urls.some(entry => entry.url === listener.publicURL)) {
    urls.push({ label: URL_LABELS.public, url: listener.publicURL, link: terminalLink(listener.publicURL, listener.publicURL), style: URL_STYLES.public })
  }
  return urls
}

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
        ...listener?.getURLs().map(({ type, url }) => [type, url, URL_STYLES[type]] as InfoSection['entries'][number]) ?? [],
        ['public', listener?.publicURL, URL_STYLES.public],
      ],
    },
    {
      heading: 'session',
      entries: [
        ['uptime', formatDuration(Date.now() - sessionStart)],
        ['requests', String(requests.total)],
        ['median', requests.total ? formatDuration(requests.medianDuration()) : undefined],
        ['directory', cwd],
      ],
    },
  ]
}

function firstSentence(message: string): string {
  return normaliseMessage(message).split('. ')[0]!
}

function renderNotification({ title, message, level }: TerminalNotification): string {
  const mark = level === 'warn' ? styleText(['yellow', 'bold'], '\u26A0') : styleText('cyan', '\u2139')
  const head = title ? `${mark} ${styleText('bold', title)}\n` : ''
  return `${head}${message}`
}

function linkVersion(version: string): string {
  const notes = releaseNotesUrl('nuxt', version)
  return notes ? terminalLink(version, notes) : version
}

async function resolveQRCode(context: ShortcutContext): Promise<string | undefined> {
  const url = context.listener?.qrURL
    || context.listener?.getURLs().find(({ type }) => type !== 'local')?.url
  if (!url) {
    return undefined
  }
  const { renderUnicodeCompact } = await import('uqr')
  return renderUnicodeCompact(url)
}

async function resolveUpdate(current?: string): Promise<string | undefined> {
  if (!current) {
    return undefined
  }
  try {
    const { checkForUpdate, isUpdateCheckEnabled } = await import('../../utils/update-check')
    if (!isUpdateCheckEnabled()) {
      return undefined
    }
    const update = await checkForUpdate('nuxt', current)
    return update?.latest
  }
  catch {
    return undefined
  }
}
