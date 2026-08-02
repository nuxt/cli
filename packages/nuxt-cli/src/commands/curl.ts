import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { styleText } from 'node:util'

import { defineCommand } from 'citty'

import { findDevServer, noDevServerMessage } from '../utils/dev-server'
import { logger } from '../utils/logger'
import { logNetworkError } from '../utils/network'
import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'

const HAS_SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i
const JSON_TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
const JSON_CONTENT_TYPE_RE = /^application\/(?:[\w.+-]+\+)?json\b/i

/** `curl --fail` uses 22 for an HTTP error response; scripts rely on it. */
const HTTP_ERROR_EXIT_CODE = 22

export default defineCommand({
  meta: {
    name: 'curl',
    description: 'Send an HTTP request to your running Nuxt dev server',
  },
  args: {
    // `url` has to precede the `dir` positional supplied by `rootDirArgs`
    url: {
      type: 'positional',
      description: 'Absolute URL, or a path resolved against the running dev server',
      valueHint: 'url|path',
    },
    ...rootDirArgs,
    method: {
      type: 'string',
      alias: 'X',
      description: 'HTTP method (default: GET, or POST when a body is provided)',
      valueHint: 'method',
    },
    header: {
      type: 'string',
      alias: 'H',
      description: 'Request header in `Name: Value` form. Can be repeated.',
      valueHint: 'header',
    },
    data: {
      type: 'string',
      alias: 'd',
      description: 'Request body. Use `@-` to read stdin and `@<file>` to read a file.',
      valueHint: 'data',
    },
    verbose: {
      type: 'boolean',
      alias: 'v',
      description: 'Print request and response headers',
    },
  },
  async run(ctx) {
    const cwd = resolveRootDir(ctx.args)
    const input = ctx.args.url
    if (!input) {
      logger.error(`Missing URL. Try ${styleText('cyan', 'nuxt curl /api/hello')}.`)
      process.exit(1)
    }

    const url = await resolveRequestUrl(input, cwd)

    const headers = new Headers()
    for (const header of toArray(ctx.args.header)) {
      const separator = header.indexOf(':')
      if (separator <= 0) {
        logger.error(`Invalid header ${styleText('cyan', header)}. Expected ${styleText('cyan', 'Name: Value')}.`)
        process.exit(1)
      }
      headers.append(header.slice(0, separator).trim(), header.slice(separator + 1).trim())
    }
    if (!headers.has('user-agent')) {
      headers.set('user-agent', 'nuxt-cli')
    }

    const body = await readRequestBody(ctx.args.data)
    if (body !== undefined && !headers.has('content-type') && isJson(body)) {
      headers.set('content-type', 'application/json')
    }

    const method = (ctx.args.method || (body === undefined ? 'GET' : 'POST')).toUpperCase()

    if (ctx.args.verbose) {
      process.stderr.write(`> ${method} ${url.pathname}${url.search} HTTP/1.1\n`)
      process.stderr.write(`> Host: ${url.host}\n`)
      for (const [name, value] of headers) {
        process.stderr.write(`> ${name}: ${value}\n`)
      }
      process.stderr.write('>\n')
    }

    let response: Response
    try {
      response = await fetch(url, { method, headers, body, redirect: 'manual' })
    }
    catch (error) {
      logNetworkError(error, { url: url.href })
      process.exit(1)
    }

    if (ctx.args.verbose) {
      process.stderr.write(`< HTTP/1.1 ${response.status} ${response.statusText}\n`)
      for (const [name, value] of response.headers) {
        process.stderr.write(`< ${name}: ${value}\n`)
      }
      process.stderr.write('<\n')
    }

    await writeResponseBody(response)

    if (!response.ok) {
      process.exit(HTTP_ERROR_EXIT_CODE)
    }
  },
})

async function resolveRequestUrl(input: string, cwd: string): Promise<URL> {
  if (HAS_SCHEME_RE.test(input)) {
    return new URL(input)
  }

  const server = await findDevServer(cwd)
  if (!server) {
    logger.error(noDevServerMessage('nuxt curl'))
    process.exit(1)
  }

  return new URL(input.startsWith('/') ? input : `/${input}`, server.url)
}

async function readRequestBody(data: string | undefined): Promise<string | undefined> {
  if (data === undefined) {
    return undefined
  }
  if (data === '@-') {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf-8')
  }
  if (data.startsWith('@')) {
    return await readFile(data.slice(1), 'utf-8')
  }
  return data
}

async function writeResponseBody(response: Response): Promise<void> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  if (!text) {
    return
  }

  const pretty = process.stdout.isTTY && JSON_CONTENT_TYPE_RE.test(contentType)
  process.stdout.write(pretty ? formatJson(text) : text)
  if (process.stdout.isTTY && !text.endsWith('\n')) {
    process.stdout.write('\n')
  }
}

function formatJson(text: string): string {
  let json: string
  try {
    json = JSON.stringify(JSON.parse(text), null, 2)
  }
  catch {
    return text
  }

  return json.replace(JSON_TOKEN_RE, (match, string: string | undefined, colon: string | undefined) => {
    if (string) {
      return colon ? styleText('cyan', string) + colon : styleText('green', string)
    }
    return styleText('yellow', match)
  })
}

function isJson(value: string): boolean {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false
  }
  try {
    JSON.parse(value)
    return true
  }
  catch {
    return false
  }
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}
