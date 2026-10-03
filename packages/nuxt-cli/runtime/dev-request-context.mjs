import { AsyncLocalStorage } from 'node:async_hooks'
import dc from 'node:diagnostics_channel'
import process from 'node:process'
import { formatWithOptions } from 'node:util'

import { consola } from 'consola'

/**
 * Attribute the app's logs, and the spans it publishes on `diagnostics_channel`,
 * to the request that caused them.
 *
 * Nitro runs the app in a worker thread, so the CLI's own request context cannot
 * reach it: `AsyncLocalStorage` does not cross threads, and neither `globalThis`
 * nor `process` is the same object either side. This runs on the app's side of
 * that boundary, opening its own context around the handler and reporting from
 * inside it. Only the request identity crosses, as a header, and only the
 * finished log or span comes back, on a `BroadcastChannel`.
 *
 * Everything here is best-effort: a dev server must never fail because a log
 * could not be attributed.
 */
const CHANNEL = 'nuxt:dev:log'
const SPAN_CHANNEL = 'nuxt:dev:span'
/** Left on the request: Nuxt reads it to attribute the error reports it publishes. */
const HEADER = 'x-nuxt-dev-request-id'
const LABEL_HEADER = 'x-nuxt-dev-request-label'

const storage = new AsyncLocalStorage()

let spanChannel

export default function (nitroApp) {
  try {
    trackRequests(nitroApp)
    reportLogs()
    trackHooks(nitroApp)
    subscribeSpans()
  }
  catch {}
}

function now() {
  return performance.timeOrigin + performance.now()
}

function postSpan(request, kind, name, start, extra) {
  try {
    if (!spanChannel) {
      spanChannel = new BroadcastChannel(SPAN_CHANNEL)
      spanChannel.unref?.()
    }
    spanChannel.postMessage({ requestId: request.id, kind, name, start, duration: now() - start, ...extra })
  }
  catch {}
}

/** A module path as a reader would name it: from its package, or from the project. */
function shortenPath(path) {
  if (!path) {
    return undefined
  }
  const file = String(path).replace(/^@(?=\/)/, '')
  const packaged = file.lastIndexOf('/node_modules/')
  if (packaged !== -1) {
    return file.slice(packaged + '/node_modules/'.length)
  }
  const root = `${process.cwd()}/`
  return file.startsWith(root) ? file.slice(root.length) : file
}

function pathOf(url) {
  try {
    const { pathname, search } = new URL(url, 'http://localhost')
    return `${pathname}${search}`
  }
  catch {
    return String(url ?? '/')
  }
}

/**
 * `TracingChannel`s published by Nuxt, h3 and Nitro, and how each span is shown.
 * All of them are published with `tracePromise`, so a span ends on `asyncEnd`
 * or `error`.
 */
const TRACING_CHANNELS = {
  'nuxt.plugin': context => ['plugin', context.plugin?.name || 'anonymous'],
  'nuxt.data': context => ['data', context.functionName ? `${context.functionName}(${context.key})` : String(context.key)],
  'nuxt.render': context => ['render', context.streaming ? 'stream' : 'renderToString'],
  'nuxt.island': context => ['island', context.islandContext?.name || 'island'],
  'nuxt.hook': context => ['hook', String(context.name ?? context.hook?.name)],
  'nuxt.middleware': context => ['middleware', context.middleware?.name || shortenPath(context.middleware?.path) || 'anonymous'],
  'h3.request': (context) => {
    const request = context.event?.req ?? context.event?.node?.req
    const label = `${request?.method || 'GET'} ${pathOf(request?.url)}`
    return [context.type === 'middleware' ? 'middleware' : 'route', label]
  },
}

/** Undici's fetch lifecycle, published as plain channels rather than a `TracingChannel`. */
const UNDICI_CHANNELS = ['undici:request:create', 'undici:request:headers', 'undici:request:trailers', 'undici:request:error']

const SUBSCRIPTION = Symbol.for('nuxt:dev:span:subscription')
const STARTED = Symbol('nuxt:dev:span:started')

/**
 * Report spans published while serving a request, against that request.
 *
 * Subscriptions are process-wide, so any left by an earlier copy of this module
 * are dropped first.
 */
function subscribeSpans() {
  globalThis[SUBSCRIPTION]?.()
  const unsubscribers = []

  for (const [name, describe] of Object.entries(TRACING_CHANNELS)) {
    const handlers = {
      start(context) {
        const request = storage.getStore()
        if (request) {
          context[STARTED] = { request, start: now() }
        }
      },
      asyncEnd: context => finishTraced(context, describe),
      error: context => finishTraced(context, describe, true),
    }
    const channel = dc.tracingChannel(name)
    channel.subscribe(handlers)
    unsubscribers.push(() => channel.unsubscribe(handlers))
  }

  const fetches = new WeakMap()
  const onFetch = {
    'undici:request:create': ({ request }) => {
      const inflight = storage.getStore()
      if (inflight) {
        fetches.set(request, { request: inflight, start: now() })
      }
    },
    'undici:request:headers': ({ request, response }) => {
      const started = fetches.get(request)
      if (started) {
        started.status = response?.statusCode
      }
    },
    'undici:request:trailers': ({ request }) => finishFetch(fetches, request),
    'undici:request:error': ({ request }) => finishFetch(fetches, request, true),
  }
  for (const name of UNDICI_CHANNELS) {
    const listener = (message) => {
      try {
        onFetch[name](message)
      }
      catch {}
    }
    dc.subscribe(name, listener)
    unsubscribers.push(() => dc.unsubscribe(name, listener))
  }

  globalThis[SUBSCRIPTION] = () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}

function finishTraced(context, describe, error) {
  const started = context[STARTED]
  if (!started) {
    return
  }
  context[STARTED] = undefined
  try {
    const [kind, name] = describe(context)
    const status = context.event?.res?.status ?? context.event?.node?.res?.statusCode
    postSpan(started.request, kind, name, started.start, {
      ...kind === 'route' && typeof status === 'number' ? { status } : {},
      ...error ? { error: true } : {},
    })
  }
  catch {}
}

function finishFetch(fetches, request, error) {
  const started = fetches.get(request)
  if (!started) {
    return
  }
  fetches.delete(request)
  const url = `${request.origin ?? ''}${request.path ?? ''}`
  postSpan(started.request, 'fetch', `${request.method || 'GET'} ${url}`, started.start, {
    ...typeof started.status === 'number' ? { status: started.status } : {},
    ...error ? { error: true } : {},
  })
}

/**
 * Time the Nitro hooks the app has listeners for. Nitro publishes no channel for
 * its hooks, so these are timed through hookable directly.
 */
function trackHooks(nitroApp) {
  const hooks = nitroApp?.hooks
  if (typeof hooks?.beforeEach !== 'function' || typeof hooks?.afterEach !== 'function') {
    return
  }
  hooks.beforeEach((event) => {
    const request = storage.getStore()
    if (request && event.context && hooks._hooks?.[event.name]?.length) {
      event.context[STARTED] = { request, start: now() }
    }
  })
  hooks.afterEach((event) => {
    const started = event.context?.[STARTED]
    if (started) {
      postSpan(started.request, 'hook', event.name, started.start)
    }
  })
}

function parseRequest(id, label) {
  if (!id) {
    return undefined
  }
  let decoded = label || ''
  try {
    decoded = decodeURIComponent(decoded)
  }
  catch {}
  return { id, label: decoded }
}

/** Run `serve` inside the context of the request `read` identifies, if any. */
function withRequest(read, remove, serve) {
  let request
  try {
    request = parseRequest(read(HEADER), read(LABEL_HEADER))
    if (request) {
      remove(LABEL_HEADER)
    }
  }
  catch {}
  return request ? storage.run(request, serve) : serve()
}

function trackRequests(nitroApp) {
  const h3App = nitroApp?.h3App
  if (typeof h3App?.handler === 'function') {
    const handler = h3App.handler
    h3App.handler = Object.assign(function (event) {
      const headers = event?.node?.req?.headers
      return withRequest(name => headers?.[name], name => delete headers[name], () => handler.call(this, event))
    }, handler)
    return
  }

  // Every nitro v3 entry, dev and deployed, serves through `nitroApp.fetch`.
  if (typeof nitroApp?.fetch === 'function') {
    const fetch = nitroApp.fetch.bind(nitroApp)
    nitroApp.fetch = (req, ...args) => withRequest(name => req?.headers?.get?.(name), name => req.headers.delete(name), () => fetch(req, ...args))
  }
}

/** `console` methods worth reporting, and the consola level each maps to. */
const CONSOLE_LEVELS = { error: 0, warn: 1, log: 3, info: 3, debug: 4, trace: 5 }

function reportLogs() {
  const channel = new BroadcastChannel(CHANNEL)
  channel.unref()

  const post = (level, logType, tag, args) => {
    try {
      const request = storage.getStore()
      channel.postMessage({
        level,
        logType,
        tag: tag || undefined,
        message: formatWithOptions({ colors: false }, ...args),
        origin: request ? 'runtime' : 'build',
        request: request?.label,
        requestId: request?.id,
      })
    }
    catch {}
  }

  consola.addReporter({
    log(logObj) {
      post(logObj.level, logObj.type, logObj.tag, logObj.args)
    },
  })

  // `consola.wrapConsole()` replaces each console method with `raw` off the
  // instance that wrapped it, so this says whether the app logs through the
  // instance above. When it does not, the app's logs never reach the reporter
  // and `console` is the only way to see them.
  // eslint-disable-next-line no-console
  if (console.log !== consola.log?.raw) {
    wrapConsole(post)
  }
}

/* eslint-disable no-console */
function wrapConsole(post) {
  for (const [type, level] of Object.entries(CONSOLE_LEVELS)) {
    const original = console[type]
    if (typeof original !== 'function') {
      continue
    }
    console[type] = function (...args) {
      post(level, type, undefined, args)
      return original.apply(this, args)
    }
  }
}
