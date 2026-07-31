import process from 'node:process'

import { styleText } from 'node:util'
import { basename } from 'pathe'
import { isWindows } from 'std-env'

import { logger } from './logger'

const PROXY_ENV_VARS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

export function hasProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return PROXY_ENV_VARS.some(key => !!env[key])
}

// Matched on flag boundaries so a path or value that merely contains the flag
// (`--require=/tmp/--use-env-proxy.js`) is not mistaken for it being enabled.
const USE_ENV_PROXY_RE = /(?:^|\s)--use-env-proxy(?:$|[\s=])/

/** The flags the running Node.js accepts, i.e. `process.allowedNodeEnvironmentFlags`. */
export interface NodeFlags {
  has: (flag: string) => boolean
}

/**
 * Whether the current Node.js can route `fetch`/`http` through `HTTP_PROXY`,
 * `HTTPS_PROXY` and `NO_PROXY` itself.
 */
export function supportsEnvProxy(flags: NodeFlags | undefined = process.allowedNodeEnvironmentFlags): boolean {
  return flags?.has('--use-env-proxy') ?? false
}

/**
 * Whether the current process routes requests through the proxy environment
 * variables. Node.js resolves this during bootstrap, so it cannot be turned on
 * from within the process.
 */
export function isEnvProxyActive(env: NodeJS.ProcessEnv = process.env, execArgv: string[] = process.execArgv, flags?: NodeFlags): boolean {
  if (!supportsEnvProxy(flags)) {
    return false
  }
  return env.NODE_USE_ENV_PROXY === '1'
    || execArgv.includes('--use-env-proxy')
    || USE_ENV_PROXY_RE.test(env.NODE_OPTIONS || '')
}

export type ProxySetupResult = 'unused' | 'active' | 'children-only' | 'unsupported'

let envProxyActive: boolean | undefined
let proxyHintShown = false

/**
 * Propagate Node.js' built-in proxy support to child processes (package manager
 * installs, the dev server) when proxy environment variables are set, and record
 * whether the current process is itself proxy-aware so failures can say so.
 */
export function setupProxySupport(env: NodeJS.ProcessEnv = process.env, flags?: NodeFlags): ProxySetupResult {
  proxyHintShown = false

  if (!hasProxyEnv(env)) {
    envProxyActive = undefined
    return 'unused'
  }
  if (!supportsEnvProxy(flags)) {
    envProxyActive = false
    return 'unsupported'
  }

  envProxyActive = isEnvProxyActive(env, process.execArgv, flags)
  env.NODE_USE_ENV_PROXY ||= '1'

  return envProxyActive ? 'active' : 'children-only'
}

const BIN_NAMES = new Set(['nuxi', 'nuxi-ng', 'nuxt', 'nuxt-cli'])
const BIN_EXTENSION_RE = /\.[cm]?js$/
const NEEDS_QUOTING_RE = /[\s"'$`]/

/**
 * The command the user typed, if it can be reconstructed. Returns `undefined`
 * when the CLI was reached indirectly (`npm create nuxt`, `npx`, programmatic
 * usage), where echoing `argv` back would suggest a command that does not exist.
 */
function getCurrentCommand(argv: string[] = process.argv): string | undefined {
  const entry = argv[1]
  if (!entry || !BIN_NAMES.has(basename(entry).replace(BIN_EXTENSION_RE, ''))) {
    return
  }
  const args = argv.slice(2).map(arg => NEEDS_QUOTING_RE.test(arg) ? JSON.stringify(arg) : arg)
  return ['nuxt', ...args].join(' ')
}

export interface CommandContext {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  windows?: boolean
  flags?: NodeFlags
}

/**
 * A copy-pasteable command that re-runs the current invocation with extra
 * environment variables, in the syntax of the shell the user is most likely in.
 * Falls back to just the assignment when the invocation is not reconstructable.
 */
export function formatRetryCommand(vars: Record<string, string>, ctx: CommandContext = {}): string {
  const { argv = process.argv, env = process.env, windows = isWindows } = ctx
  const command = getCurrentCommand(argv)
  const entries = Object.entries(vars)

  if (windows) {
    // `$env:` assignments only work in PowerShell, `set` only in cmd.exe.
    const isPowerShell = !!env.PSModulePath
    const assignments = entries.map(([key, value]) => isPowerShell ? `$env:${key}="${value}"` : `set ${key}=${value}`)
    const separator = isPowerShell ? '; ' : ' && '
    return [...assignments, ...command ? [command] : []].join(separator)
  }

  const assignments = entries.map(([key, value]) => `${key}=${value}`)
  return command ? [...assignments, command].join(' ') : `export ${assignments.join(' ')}`
}

// Some libraries (notably `giget`) rethrow with the original error stringified
// into the message, which drops the `code` we would otherwise read.
const ERROR_CODE_RE = /\b(E(?:NOTFOUND|AI_AGAIN|CONNREFUSED|CONNRESET|TIMEDOUT|PIPE|PROTO)|UND_ERR_[A-Z_]+|ERR_(?:SSL|TLS)_[A-Z_]+|(?:CERT|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO)[A-Z_]*)\b/

function getErrorCode(err: unknown): string | undefined {
  let current = err
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') {
      return code
    }
    const message = (current as { message?: unknown }).message
    if (typeof message === 'string') {
      const match = message.match(ERROR_CODE_RE)
      if (match) {
        return match[1]
      }
    }
    current = (current as { cause?: unknown }).cause
  }
}

function getErrorName(err: unknown): string | undefined {
  let current = err
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const name = (current as { name?: unknown }).name
    if (typeof name === 'string' && name !== 'Error' && name !== 'TypeError' && name !== 'FetchError') {
      return name
    }
    current = (current as { cause?: unknown }).cause
  }
}

function getStatus(err: unknown): number | undefined {
  const status = err as { status?: unknown, statusCode?: unknown, response?: { status?: unknown } }
  for (const value of [status?.status, status?.statusCode, status?.response?.status]) {
    if (typeof value === 'number') {
      return value
    }
  }
}

function getHost(url: string | undefined): string | undefined {
  if (!url) {
    return
  }
  try {
    return new URL(url).host
  }
  catch {
    return undefined
  }
}

export type NetworkFailureKind = 'dns' | 'timeout' | 'refused' | 'reset' | 'tls' | 'proxy-auth' | 'http' | 'unknown'

export interface NetworkFailure {
  kind: NetworkFailureKind
  code?: string
  status?: number
}

export function classifyNetworkError(err: unknown): NetworkFailure {
  const code = getErrorCode(err)
  const status = getStatus(err)

  if (status) {
    return { kind: status === 407 ? 'proxy-auth' : 'http', status, code }
  }

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { kind: 'dns', code }
    case 'ECONNREFUSED':
      return { kind: 'refused', code }
    case 'ECONNRESET':
    case 'EPIPE':
      return { kind: 'reset', code }
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return { kind: 'timeout', code }
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'EPROTO':
      return { kind: 'tls', code }
  }

  // OpenSSL surfaces handshake failures (wrong protocol, unsupported ciphers,
  // hostname mismatch) through a large family of prefixed codes.
  if (code?.startsWith('ERR_SSL_') || code?.startsWith('ERR_TLS_')) {
    return { kind: 'tls', code }
  }

  if (code === 'ABORT_ERR' || getErrorName(err) === 'AbortError' || getErrorName(err) === 'TimeoutError') {
    return { kind: 'timeout', code }
  }

  return { kind: 'unknown', code }
}

/**
 * `giget` flattens the underlying failure to `TypeError: fetch failed`, dropping
 * both `cause` and `code`, so DNS, refused and timed-out downloads are
 * indistinguishable. Re-request the origin to recover a diagnosable error.
 * Returns `undefined` when the origin turns out to be reachable.
 */
export async function probeNetworkError(url: string, timeout = 3000): Promise<unknown | undefined> {
  let origin: string
  try {
    origin = new URL(url).origin
  }
  catch {
    return
  }

  try {
    await fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(timeout) })
  }
  catch (err) {
    return err
  }
}

/** A single-line, human-readable explanation of a failed network request. */
export function describeNetworkError(err: unknown, url?: string): string {
  const host = getHost(url)
  const target = host ? styleText('cyan', host) : 'the network'
  const { kind, code, status } = classifyNetworkError(err)

  switch (kind) {
    case 'proxy-auth':
      return `Proxy rejected the request to ${target} with status ${styleText('yellow', '407')} (proxy authentication required).`
    case 'http':
      return `Request to ${target} failed with status ${styleText('yellow', String(status))}.`
    case 'dns':
      return code === 'EAI_AGAIN'
        ? `DNS lookup for ${target} timed out.`
        : `Could not resolve ${target} (DNS lookup failed).`
    case 'refused':
      return `Connection to ${target} was refused.`
    case 'reset':
      return `Connection to ${target} was reset before the response completed.`
    case 'timeout':
      return `Connection to ${target} timed out.`
    case 'tls':
      return `TLS connection to ${target} could not be verified (${code}).`
  }

  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('fetch failed')) {
    return `Could not reach ${target}.`
  }
  return `Could not reach ${target}: ${message}`
}

/**
 * Advice for failures a proxy could explain, naming the command to re-run.
 * Returns `undefined` when the proxy is already in use or cannot be at fault.
 */
export function getProxyHint(kind: NetworkFailureKind = 'unknown', ctx: CommandContext = {}): string | undefined {
  const env = ctx.env ?? process.env
  const proxyInUse = () => envProxyActive ?? isEnvProxyActive(env, process.execArgv, ctx.flags)

  // A server that answered is normally not a proxy problem, unless a proxy is
  // configured and being bypassed (a blocked egress often answers 403).
  if (kind === 'http' && (!hasProxyEnv(env) || proxyInUse())) {
    return
  }

  if (kind === 'tls') {
    return `This usually means a proxy is re-signing TLS traffic. Retry with your organisation's root certificate: ${styleText('cyan', formatRetryCommand({ NODE_EXTRA_CA_CERTS: '/path/to/corporate-ca.pem' }, ctx))}`
  }

  if (kind === 'proxy-auth') {
    return `Include credentials in your proxy URL, e.g. ${styleText('cyan', 'HTTPS_PROXY=http://user:password@proxy.example.com:8080')}.`
  }

  if (!hasProxyEnv(env)) {
    return `If you are behind a proxy, set ${styleText('cyan', 'HTTPS_PROXY')} and ${styleText('cyan', 'NODE_USE_ENV_PROXY=1')} (plus ${styleText('cyan', 'NO_PROXY')} for internal hosts).`
  }

  if (!supportsEnvProxy(ctx.flags)) {
    return `A proxy is configured but this version of Node.js cannot use it; upgrade to Node.js 24 (or 22.18+) to enable ${styleText('cyan', 'NODE_USE_ENV_PROXY')}.`
  }

  if (!proxyInUse()) {
    return `A proxy is configured but Node.js only reads it at startup. Retry with ${styleText('cyan', formatRetryCommand({ NODE_USE_ENV_PROXY: '1' }, ctx))}`
  }

  // A connection dropped mid-handshake through a proxy that is genuinely in use
  // is the usual signature of TLS interception with an untrusted root.
  if (kind === 'reset') {
    return `The proxy may be re-signing TLS traffic. Retry with your organisation's root certificate: ${styleText('cyan', formatRetryCommand({ NODE_EXTRA_CA_CERTS: '/path/to/corporate-ca.pem' }, ctx))}`
  }
}

export interface LogNetworkErrorOptions {
  url?: string
  /** Extra advice, shown before the proxy hint. */
  hints?: string[]
  /** Context prepended to the description, e.g. which package failed. */
  prefix?: string
  /** Use `warn` where the command carries on regardless. */
  level?: 'error' | 'warn'
}

/**
 * Log a failed network request together with at most one line of advice. The
 * proxy hint is shown once per process: several requests usually fail for the
 * same reason, and repeating the retry command for each one is noise.
 */
export function logNetworkError(err: unknown, options: LogNetworkErrorOptions = {}): void {
  const description = describeNetworkError(err, options.url)
  const message = options.prefix ? `${options.prefix} ${description}` : description
  logger[options.level === 'warn' ? 'warn' : 'error'](message)

  const proxyHint = proxyHintShown ? undefined : getProxyHint(classifyNetworkError(err).kind)
  proxyHintShown ||= !!proxyHint

  const hints = [...options.hints || [], proxyHint].filter(Boolean) as string[]
  if (hints.length > 0) {
    logger.info(hints.join(' '))
  }
}
