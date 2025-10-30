import type { IncomingMessage, ServerResponse } from 'node:http'
import { Youch } from 'youch'

export async function renderError(req: IncomingMessage, res: ServerResponse, error: unknown) {
  if (res.headersSent) {
    if (!res.writableEnded) {
      res.end()
    }
    return
  }

  const youch = new Youch()
  res.statusCode = 500
  res.setHeader('Content-Type', 'text/html')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Refresh', '3')

  const html = await youch.toHTML(error, {
    request: {
      url: req.url,
      method: req.method,
      headers: req.headers,
    },
  })
  res.end(html)
}
