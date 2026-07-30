import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RenderErrorOptions } from './error'

export async function renderError(req: IncomingMessage, res: ServerResponse, error: unknown, options: RenderErrorOptions = {}): Promise<void> {
  const { renderError } = await import('./error')
  return renderError(req, res, error, options)
}

export async function renderErrorAnsi(error: unknown): Promise<string> {
  const { renderErrorAnsi } = await import('./error')
  return renderErrorAnsi(error)
}
