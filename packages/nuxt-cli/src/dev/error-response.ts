import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ErrorResponseOptions {
  /** Markup appended to the rendered page, used to make the error page live. */
  inject?: string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => ESCAPES[character]!)
}

/**
 * Answer a request with the little that can be said without a report: the
 * message, and the stack where there is one.
 */
export async function sendErrorResponse(req: IncomingMessage, res: ServerResponse, error: unknown, options: ErrorResponseOptions = {}): Promise<void> {
  if (res.headersSent) {
    if (!res.writableEnded) {
      res.end()
    }
    return
  }

  const err = error as Partial<Error> & { data?: unknown }
  const useJSON = !req.headers.accept?.includes('text/html')

  res.statusCode = 500
  res.setHeader('Content-Type', useJSON ? 'application/json' : 'text/html')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (!options.inject) {
    res.setHeader('Refresh', '3')
  }

  if (useJSON) {
    res.end(JSON.stringify({
      error: true,
      url: req.url,
      status: 500,
      message: err?.message || 'Unknown error',
      data: err?.data,
      stack: err?.stack?.split('\n').map(line => line.trim()),
    }, null, 2))
    return
  }

  const message = escapeHtml(err?.message || 'Unknown error')
  const stack = err?.stack ? `<pre>${escapeHtml(err.stack)}</pre>` : ''
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${message}</title></head>`
    + `<body><h1>${message}</h1>${stack}</body></html>${options.inject ?? ''}`)
}
