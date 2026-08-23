import { AsyncLocalStorage } from 'node:async_hooks'
import { formatWithOptions } from 'node:util'

import { consola } from 'consola'

/**
 * Attribute the app's logs to the request that caused them.
 *
 * Nitro runs the app in a worker thread, so the CLI's own request context cannot
 * reach it: `AsyncLocalStorage` does not cross threads, and neither `globalThis`
 * nor `process` is the same object either side. This runs on the app's side of
 * that boundary, opening its own context around the handler and reporting from
 * inside it. Only the request identity crosses, as a header, and only the
 * finished log comes back, on a `BroadcastChannel`.
 *
 * Everything here is best-effort: a dev server must never fail because a log
 * could not be attributed.
 */
const CHANNEL = 'nuxt:dev:log'
const HEADER = 'x-nuxt-dev-request-id'

const storage = new AsyncLocalStorage()

export default function (nitroApp) {
  try {
    trackRequests(nitroApp)
    reportLogs()
  }
  catch {}
}

function parseRequest(header) {
  if (!header) {
    return undefined
  }
  const separator = header.indexOf(' ')
  const id = Number(header.slice(0, separator))
  return Number.isFinite(id) ? { id, label: header.slice(separator + 1) } : undefined
}

function trackRequests(nitroApp) {
  const h3App = nitroApp?.h3App
  if (typeof h3App?.handler === 'function') {
    const handler = h3App.handler
    h3App.handler = Object.assign(function (event) {
      let request
      try {
        const headers = event?.node?.req?.headers
        request = parseRequest(headers?.[HEADER])
        if (request) {
          delete headers[HEADER]
        }
      }
      catch {}
      return request
        ? storage.run(request, () => handler.call(this, event))
        : handler.call(this, event)
    }, handler)
    return
  }

  const h3 = nitroApp?.h3
  if (typeof h3?.fetch === 'function') {
    const fetch = h3.fetch.bind(h3)
    h3.fetch = (req, ...args) => {
      let request
      try {
        request = parseRequest(req?.headers?.get?.(HEADER))
        if (request) {
          req.headers.delete(HEADER)
        }
      }
      catch {}
      return request
        ? storage.run(request, () => fetch(req, ...args))
        : fetch(req, ...args)
    }
  }
}

function reportLogs() {
  const channel = new BroadcastChannel(CHANNEL)
  channel.unref()
  consola.addReporter({
    log(logObj) {
      try {
        const request = storage.getStore()
        channel.postMessage({
          level: logObj.level,
          logType: logObj.type,
          tag: logObj.tag || undefined,
          message: formatWithOptions({ colors: false }, ...logObj.args),
          origin: request ? 'runtime' : 'build',
          request: request?.label,
          requestId: request?.id,
        })
      }
      catch {}
    },
  })
}
