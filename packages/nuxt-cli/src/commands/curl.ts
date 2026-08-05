import type { HighlightLanguage } from '../utils/highlight'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { styleText } from 'node:util'

import { note } from '@clack/prompts'
import { defineCommand } from 'citty'

import { findDevServer, noDevServerMessage } from '../utils/dev-server'
import { formatHtml } from '../utils/format-html'
import { highlight } from '../utils/highlight'
import { logger } from '../utils/logger'
import { logNetworkError } from '../utils/network'
import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'

const HAS_SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i
const JSON_CONTENT_TYPE_RE = /^application\/(?:[\w.+-]+\+)?json\b/i
/** Markup reindented as HTML: the HTML rules cover XML documents too. */
const MARKUP_CONTENT_TYPE_RE = /^(?:text\/(?:html|xml)|(?:application|image)\/(?:[\w.+-]+\+)?xml)\b/i

/** Newline-delimited JSON keeps one record per line, so each line is highlighted on its own. */
const NDJSON_CONTENT_TYPE_RE = /^application\/(?:x-ndjson|jsonl|json-seq)\b/i

/** Languages worth highlighting a response body in, keyed by content type. */
const CONTENT_TYPE_LANGUAGES: [RegExp, HighlightLanguage][] = [
  [/^text\/(?:x-)?markdown\b/i, 'md'],
  [/^(?:text|application)\/(?:x-)?(?:[\w.+-]+\+)?ya?ml\b/i, 'yaml'],
  [/^text\/css\b/i, 'css'],
  [/^(?:text|application)\/(?:x-)?(?:java|ecma)script\b/i, 'js'],
  [/^(?:text|application)\/(?:x-)?typescript\b/i, 'ts'],
  [/^(?:text\/x-(?:diff|patch)|application\/x-patch)\b/i, 'diff'],
  [/^(?:text\/x-(?:sh|shellscript)|application\/x-sh(?:ellscript)?)\b/i, 'bash'],
  [/^(?:text|application)\/x-python\b/i, 'py'],
  [/^message\/http\b/i, 'http'],
]
const TEXT_CONTENT_TYPE_RE = /^(?:text\/|application\/(?:[\w.+-]+\+)?(?:json|xml|yaml)\b|application\/(?:javascript|ecmascript|x-www-form-urlencoded|x-ndjson)\b)/i

const BINARY_SNIFF_BYTES = 4096

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
    include: {
      type: 'boolean',
      alias: 'i',
      description: 'Include the response status line and headers in the output',
    },
    head: {
      type: 'boolean',
      alias: 'I',
      description: 'Send a `HEAD` request and show only the response headers',
    },
    verbose: {
      type: 'boolean',
      alias: 'v',
      description: 'Print request and response headers to stderr',
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
    for (const header of collectRepeated(ctx.rawArgs, 'header', 'H')) {
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

    const defaultMethod = ctx.args.head ? 'HEAD' : (body === undefined ? 'GET' : 'POST')
    const method = (ctx.args.method || defaultMethod).toUpperCase()

    if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
      logger.error(`A ${styleText('cyan', method)} request cannot have a body. Remove ${styleText('cyan', '-d')} or use a different method.`)
      process.exit(1)
    }

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
      process.stderr.write(formatResponseHead(response, '< ', process.stderr))
    }

    if (ctx.args.include || ctx.args.head) {
      process.stdout.write(formatResponseHead(response, '', process.stdout))
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

/**
 * citty keeps only the last value of a repeated string flag, so repeatable
 * options are read back off the raw argv instead of `ctx.args`.
 */
function collectRepeated(rawArgs: string[], name: string, alias: string): string[] {
  const values: string[] = []
  const end = rawArgs.indexOf('--')
  const argv = end === -1 ? rawArgs : rawArgs.slice(0, end)

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === `--${name}` || arg === `-${alias}`) {
      const value = argv[++index]
      if (value !== undefined) {
        values.push(value)
      }
      continue
    }
    if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3))
    }
    else if (arg.startsWith(`-${alias}=`)) {
      values.push(arg.slice(alias.length + 2))
    }
  }

  return values
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
    const path = data.slice(1)
    try {
      return await readFile(path, 'utf-8')
    }
    catch (error) {
      logger.error(`Could not read ${styleText('cyan', path)}: ${(error as Error).message}`)
      process.exit(1)
    }
  }
  return data
}

function statusStyle(status: number): 'green' | 'cyan' | 'yellow' | 'red' {
  if (status >= 500) {
    return 'red'
  }
  if (status >= 400) {
    return 'yellow'
  }
  if (status >= 300) {
    return 'cyan'
  }
  return 'green'
}

function formatResponseHead(response: Response, prefix: string, stream: NodeJS.WriteStream): string {
  const status = styleText(statusStyle(response.status), `${response.status} ${response.statusText}`.trimEnd(), { stream })
  let head = `${prefix}${styleText('dim', 'HTTP/1.1', { stream })} ${status}\n`
  for (const [name, value] of response.headers) {
    head += `${prefix}${styleText('blue', name, { stream })}: ${value}\n`
  }
  return `${head}${prefix.trimEnd()}\n`
}

async function writeResponseBody(response: Response): Promise<void> {
  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) {
    return
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(buffer)
    return
  }

  if (isBinary(buffer, contentType)) {
    note('Binary data not shown in terminal. Redirect the output to a file to save it.', 'Response body')
    return
  }

  const body = formatBody(buffer.toString('utf-8'), contentType)
  process.stdout.write(body)
  if (!body.endsWith('\n')) {
    process.stdout.write('\n')
  }
}

/**
 * A textual content type is trusted outright; anything else is sniffed for a
 * NUL byte, which no valid UTF-8 text response contains.
 */
function isBinary(buffer: Buffer, contentType: string): boolean {
  if (TEXT_CONTENT_TYPE_RE.test(contentType)) {
    return false
  }
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

function formatBody(text: string, contentType: string): string {
  if (JSON_CONTENT_TYPE_RE.test(contentType)) {
    let json: string
    try {
      json = JSON.stringify(JSON.parse(text), null, 2)
    }
    catch {
      return text
    }
    return highlight(json, 'json')
  }

  if (NDJSON_CONTENT_TYPE_RE.test(contentType)) {
    return text.replace(/[^\n]+/g, line => highlight(line, 'json'))
  }

  if (MARKUP_CONTENT_TYPE_RE.test(contentType)) {
    return highlight(formatHtml(text), 'html')
  }

  const language = CONTENT_TYPE_LANGUAGES.find(([pattern]) => pattern.test(contentType))?.[1]
  return language ? highlight(text, language) : text
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
