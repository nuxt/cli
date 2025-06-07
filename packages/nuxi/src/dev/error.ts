import type { IncomingMessage, ServerResponse } from 'node:http'
import { Youch } from 'youch'

export async function renderError(req: IncomingMessage, res: ServerResponse, error: unknown) {
  const youch = new Youch()
  res.statusCode = 500
  res.setHeader('Content-Type', 'text/html')
  const html = await youch.toHTML(error, {
    request: {
      url: req.url,
      method: req.method,
      headers: req.headers,
    },
  })
  res.end(html)
}
