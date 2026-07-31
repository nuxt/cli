import type { IncomingMessage, ServerResponse } from 'node:http'

export async function renderError(req: IncomingMessage, res: ServerResponse, error: unknown): Promise<void> {
  const { renderError } = await import('./error')
  return renderError(req, res, error)
}

export async function renderErrorAnsi(error: unknown): Promise<string> {
  const { renderErrorAnsi } = await import('./error')
  return renderErrorAnsi(error)
}
