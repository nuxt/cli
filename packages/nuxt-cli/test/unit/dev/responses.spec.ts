import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, expect, it } from 'vitest'

import { renderError } from '../../../src/dev/error'
import { NuxtDevServer } from '../../../src/dev/utils'

interface FakeResponse {
  body: string
  statusCode: number
  headersSent: boolean
  headers: Record<string, string>
  finished: Promise<void>
  response: ServerResponse
}

function createRequest(accept?: string, url = '/'): IncomingMessage {
  return { url, method: 'GET', headers: accept ? { accept } : {} } as unknown as IncomingMessage
}

function createResponse(): FakeResponse {
  const headers: Record<string, string> = {}
  let done: () => void
  const finished = new Promise<void>((resolve) => {
    done = resolve
  })
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    headers,
    finished,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    once() {},
    end(chunk?: string) {
      if (chunk) {
        res.body += chunk
      }
      res.writableEnded = true
      res.headersSent = true
      done()
    },
  }
  return new Proxy(res, {
    get(target, key) {
      return key === 'response' ? target : Reflect.get(target, key)
    },
  }) as unknown as FakeResponse
}

describe('renderError', () => {
  it('should escape an error message in the html error page', async () => {
    const res = createResponse()
    await renderError(createRequest('text/html'), res.response, new Error('<script>alert(1)</script>'))

    expect(res.statusCode).toBe(500)
    expect(res.headers['content-type']).toBe('text/html')
    expect(res.body).not.toContain('<script>alert(1)</script>')
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('should escape a reflected request url in the html error page', async () => {
    const res = createResponse()
    await renderError(createRequest('text/html', '/</script><script>alert(1)</script>'), res.response, new Error('boom'))

    expect(res.body).not.toContain('<script>alert(1)</script>')
  })

  it('should answer a non-html client with json', async () => {
    const res = createResponse()
    await renderError(createRequest('application/json'), res.response, new Error('boom'))

    expect(res.headers['content-type']).toBe('application/json')
    expect(JSON.parse(res.body)).toMatchObject({ error: true, status: 500, message: 'boom' })
  })

  it('should send hardening headers with the error page', async () => {
    const res = createResponse()
    await renderError(createRequest('text/html'), res.response, new Error('boom'))

    expect(res.headers).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    })
  })

  it('should not write a body once headers have been sent', async () => {
    const res = createResponse()
    res.headersSent = true
    await renderError(createRequest('text/html'), res.response, new Error('boom'))

    expect(res.body).toBe('')
  })

  it('should render a non-error rejection value', async () => {
    const res = createResponse()
    await renderError(createRequest('application/json'), res.response, 'just a string')

    expect(JSON.parse(res.body)).toMatchObject({ status: 500, message: 'Unknown error' })
  })
})

describe('dev server loading screen', () => {
  function createDevServer(loadingTemplate?: (data: { loading?: string }) => string) {
    return new NuxtDevServer({ cwd: process.cwd(), dotenv: {}, overrides: {}, loadingTemplate })
  }

  it('should serve the loading template to a browser', async () => {
    const server = createDevServer(({ loading }) => `<p>${loading}</p>`)
    const res = createResponse()

    server.handler(createRequest('text/html'), res as unknown as ServerResponse)
    await res.finished

    expect(res.statusCode).toBe(503)
    expect(res.headers['content-type']).toBe('text/html')
    expect(res.body).toBe('<p>Loading...</p>')
  })

  it('should serve json to a non-browser client', async () => {
    const server = createDevServer(() => '<p>ignored</p>')
    const res = createResponse()

    server.handler(createRequest('application/json'), res as unknown as ServerResponse)
    await res.finished

    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toMatchObject({ error: true, status: 503 })
  })

  it('should ask clients to retry rather than caching the placeholder', async () => {
    const server = createDevServer(() => 'loading')
    const res = createResponse()

    server.handler(createRequest('text/html'), res as unknown as ServerResponse)
    await res.finished

    expect(res.headers).toMatchObject({ 'cache-control': 'no-store', 'refresh': '3' })
  })
})
