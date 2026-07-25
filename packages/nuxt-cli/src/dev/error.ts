import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SourceLoader, StackFrame } from 'youch-core/types'

import { readFile } from 'node:fs/promises'
import process from 'node:process'

import { dirname, resolve } from 'pathe'
import { SourceMapConsumer } from 'source-map'
import { Youch } from 'youch'
import { ErrorParser } from 'youch-core'

import { debug } from '../utils/logger'

export async function renderError(req: IncomingMessage, res: ServerResponse, error: unknown) {
  if (res.headersSent) {
    if (!res.writableEnded) {
      res.end()
    }
    return
  }

  await loadStackTrace(error).catch(err => debug('Failed to load stack trace:', err))

  const useJSON = !req.headers.accept?.includes('text/html')

  res.statusCode = 500
  res.setHeader('Content-Type', useJSON ? 'application/json' : 'text/html')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Refresh', '3')

  if (useJSON) {
    const err = error as Partial<Error> & { data?: unknown }
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

  const youch = new Youch()
  const html = await youch.toHTML(error, {
    request: {
      url: req.url,
      method: req.method,
      headers: req.headers,
    },
  })
  res.end(html)
}

/** Render the error with source-mapped frames as ANSI for terminal output. */
export async function renderErrorAnsi(error: unknown): Promise<string> {
  await loadStackTrace(error).catch(err => debug('Failed to load stack trace:', err))
  const ansi = await new Youch().toANSI(error)
  return ansi.replaceAll(process.cwd(), '.')
}

const sourceLoader: SourceLoader = async (frame) => {
  if (!frame.fileName || frame.fileType !== 'fs' || frame.type === 'native') {
    return
  }
  if (frame.type === 'app') {
    await applySourceMap(frame).catch(error => debug(`Failed to source-map \`${frame.fileName}\`:`, error))
  }
  const contents = await readFile(frame.fileName, 'utf8').catch(() => undefined)
  return contents ? { contents } : undefined
}

/**
 * Rewrite a frame to its original position. Isolated per frame so a malformed
 * `.map` costs only that frame's mapping rather than the whole stack.
 */
async function applySourceMap(frame: StackFrame): Promise<void> {
  const rawSourceMap = await readFile(`${frame.fileName}.map`, 'utf8').catch(() => undefined)
  if (!rawSourceMap) {
    return
  }
  // Consumers hold WASM memory that is only reclaimed by `destroy()`.
  const consumer = await new SourceMapConsumer(rawSourceMap)
  try {
    const originalPosition = consumer.originalPositionFor({
      line: frame.lineNumber!,
      column: frame.columnNumber!,
    })
    if (originalPosition.source && originalPosition.line) {
      frame.fileName = resolve(dirname(frame.fileName!), originalPosition.source)
      frame.lineNumber = originalPosition.line
      frame.columnNumber = originalPosition.column || 0
    }
  }
  finally {
    consumer.destroy()
  }
}

/** Rewrite the error stack (and causes) with source-mapped file names and positions. */
async function loadStackTrace(error: unknown): Promise<void> {
  if (!(error instanceof Error)) {
    return
  }
  const parsed = await new ErrorParser().defineSourceLoader(sourceLoader).parse(error)
  const stack = `${error.message}\n${parsed.frames.map(frame => fmtFrame(frame)).join('\n')}`
  Object.defineProperty(error, 'stack', { value: stack })
  if (error.cause) {
    await loadStackTrace(error.cause).catch(err => debug('Failed to load stack trace of cause:', err))
  }
}

function fmtFrame(frame: StackFrame): string {
  if (frame.type === 'native') {
    return frame.raw ?? ''
  }
  const src = `${frame.fileName || ''}:${frame.lineNumber}:${frame.columnNumber}`
  return frame.functionName ? `    at ${frame.functionName} (${src})` : `    at ${src}`
}
