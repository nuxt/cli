import type { Server as HttpServer, RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HTTPSOptions, ResolvedCertificate } from './cert'
import type { Tunnel } from './tunnel'

import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { networkInterfaces } from 'node:os'
import process from 'node:process'

import { styleText } from 'node:util'
import { getPort } from 'get-port-please'

import { ActionableError } from '../utils/errors'
import { debug, logger } from '../utils/logger'
import { detectIsolatedEnvironment, isWsl } from './environment'
import { resolvePortlessURLs } from './portless'
import { resolveStackblitzURL } from './stackblitz'

export interface ListenOptions {
  port?: string | number
  /** Fail instead of falling back to another port when `port` is unavailable. */
  strictPort?: boolean
  /** Bind with `SO_REUSEPORT` so a successor can bind the same port before this one is released. */
  reusePort?: boolean
  /**
   * Bind `port` as given, without checking whether it is free. Used together with
   * `reusePort` when taking over from a process that still holds the port.
   */
  handover?: boolean
  hostname?: string
  baseURL?: string
  showURL?: boolean
  open?: boolean
  /** Path (resolved against the dev server URL) or absolute URL to open. */
  openURL?: string
  clipboard?: boolean
  qr?: boolean
  tunnel?: boolean
  public?: boolean
  publicURL?: string
  https?: boolean | HTTPSOptions
}

interface ListenURL {
  url: string
  type: 'local' | 'network' | 'tunnel' | 'public'
}

/**
 * CLI-provided listen options. `httpsEnabled` mirrors the presence of `--https`
 * so `nuxt.config` can supply the default when the flag is absent.
 */
export interface DevListenOverrides extends ListenOptions {
  httpsEnabled?: boolean
}

export interface Listener {
  url: string
  /** Explicit public URL, or the tunnel or portless URL when there is one. */
  publicURL?: string
  /** URL the startup QR code was (or would have been) rendered for. */
  qrURL?: string
  address: AddressInfo
  server: HttpServer
  https: false | ResolvedCertificate
  close: () => Promise<void>
  getURLs: () => ListenURL[]
  /** Reprint the URL block, optionally flagging which URL a QR code refers to. */
  showURLs: (options?: { qr?: boolean }) => void
}

const ANY_HOSTS = new Set(['', '0.0.0.0', '::'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_PORTS = { http: 80, https: 443 } as const

/** How long in-flight requests have to finish before their sockets are killed. */
const CONNECTION_DRAIN_TIMEOUT_MS = 1000

/**
 * Render a URL for display: the port is omitted when it is the protocol
 * default, and percent-encoding is decoded so a non-ASCII `baseURL` is
 * readable. A malformed sequence is left as-is rather than throwing.
 */
export function formatDisplayURL(protocol: 'http' | 'https', host: string, port: number, baseURL: string): string {
  const hostname = host.includes(':') ? `[${host}]` : host
  const suffix = port === DEFAULT_PORTS[protocol] ? '' : `:${port}`
  const url = `${protocol}://${hostname}${suffix}${baseURL}`
  try {
    return decodeURI(url)
  }
  catch {
    return url
  }
}

const HOSTNAME_RE = /^(?!-)[\d.:a-z-]{1,253}(?<!-)$/i

/**
 * Check `hostname` is a plausible host or IP address, falling back to a
 * bindable default (with a warning) when it is not.
 */
export function validateHostname(hostname: string | undefined, isPublic?: boolean, options: { silent?: boolean } = {}): string | undefined {
  const isValid = !!hostname
    && HOSTNAME_RE.test(hostname)
    && hostname.split('.').every(label => label.length <= 63)
  if (!hostname || isValid) {
    return hostname
  }
  const fallback = isPublic ? '' : 'localhost'
  if (!options.silent) {
    logger.warn(`Invalid host \`${hostname}\`, using \`${fallback || '0.0.0.0'}\` instead.`)
  }
  return fallback
}

/** Hostname `bindListener` will bind for `options`. */
function resolveBindHostname(options: ListenOptions, silent = false): string {
  const isolated = options.hostname === undefined && !options.public && detectIsolatedEnvironment()
  return validateHostname(options.hostname, options.public, { silent }) ?? (options.public || isolated ? '' : 'localhost')
}

/**
 * Whether an already bound server can serve `options`, so a listener bound
 * before the Nuxt config was known can be kept rather than rebound.
 */
export function matchesBoundTarget(bound: BoundServer, options: ListenOptions): boolean {
  if (resolveBindHostname(options, true) !== bound.hostname) {
    return false
  }
  if (!!options.https !== !!bound.https) {
    return false
  }
  // Parsed leniently: an unusable port cannot match, and reporting that is
  // `bindListener`'s job rather than this comparison's.
  const port = options.port === undefined || options.port === '' ? undefined : Number(options.port)
  return port === undefined || port === bound.address.port || port === bound.requestedPort
}

/**
 * External IPv4 addresses other devices can reach. IPv4 link-local addresses
 * (169.254.0.0/16, from a macOS Thunderbolt Bridge or an unconfigured adapter)
 * are excluded because they are unreachable from the rest of the network.
 */
export function getNetworkAddresses(): string[] {
  const addresses: string[] = []
  for (const info of Object.values(networkInterfaces()).flat()) {
    if (!info || info.internal || info.family !== 'IPv4' || info.address.startsWith('169.254.')) {
      continue
    }
    addresses.push(info.address)
  }
  return addresses
}

/**
 * OpenSSL 3 moved the ciphers used by older PKCS#12 exports (RC2-40, RC4, DES)
 * into the legacy provider, which Node does not load, so such keystores fail
 * with `ERR_CRYPTO_UNSUPPORTED_OPERATION`.
 */
function createSecureServer(certificate: ResolvedCertificate, handler: RequestListener): HttpServer {
  try {
    return createHttpsServer(certificate, handler)
  }
  catch (error) {
    if (certificate.pfx && (error as NodeJS.ErrnoException)?.code === 'ERR_CRYPTO_UNSUPPORTED_OPERATION') {
      throw new Error([
        `Could not read \`${certificate.pfxPath}\`: it uses encryption that OpenSSL 3 no longer enables by default.`,
        'Convert it once with:',
        `  openssl pkcs12 -legacy -in ${certificate.pfxPath} -nodes -out converted.pem`,
        '  openssl pkcs12 -export -in converted.pem -out converted.pfx',
        'Alternatively, pass `--https.cert` and `--https.key`.',
      ].join('\n'), { cause: error })
    }
    throw error
  }
}

/** A bound socket, before any URL resolution, tunnel or console output. */
export interface BoundServer {
  server: HttpServer
  address: AddressInfo
  https: false | ResolvedCertificate
  hostname: string
  /** Port that was asked for, before any in-use fallback. */
  requestedPort?: number
}

/**
 * Bind a socket and nothing else, so the port can be taken before the Nuxt
 * config is known and requests can be answered while it loads.
 */
export async function bindListener(handler: RequestListener, options: ListenOptions = {}): Promise<BoundServer> {
  const hostname = resolveBindHostname(options)

  const requestedPort = parsePort(options.port)
  const port = options.handover && requestedPort
    ? requestedPort
    : await resolvePort(requestedPort, hostname, options.strictPort)

  const httpsOptions = options.https === true ? {} : options.https
  // `cert` and `tunnel` reach `dev/binaries.ts`, which pulls in `rc9` and the
  // clack spinner. Neither is wanted unless `--https` or `--tunnel` is passed.
  const certificate = httpsOptions
    ? await import('./cert').then(({ resolveCertificate }) => resolveCertificate(httpsOptions))
    : false
  const server = certificate
    ? createSecureServer(certificate, handler)
    : createHttpServer(handler)

  await bindServer(server, port, hostname, !!options.reusePort).catch((error) => {
    throw describeBindError(error, port, hostname, options.strictPort)
  })
  // Without a persistent handler, any later `error` event is unhandled and
  // takes the whole dev process down.
  server.on('error', error => logger.error(`Dev server error: ${error.message}`))

  return { server, address: server.address() as AddressInfo, https: certificate, hostname, requestedPort }
}

/**
 * Resolve the URLs of an already bound server and, unless `announce` is false,
 * start any tunnel and print, copy and open the URLs.
 */
export async function createListener(bound: BoundServer, options: ListenOptions = {}, { announce = true }: { announce?: boolean } = {}): Promise<Listener> {
  const { server, address, hostname, https: certificate } = bound

  // Set before anything that can throw, so a failure after the tunnel is up can
  // still tear down the cloudflared process rather than leaking it until exit.
  let tunnel: Tunnel | undefined

  try {
    return await resolveListener()
  }
  catch (error) {
    await tunnel?.close().catch(() => {})
    throw error
  }

  async function resolveListener(): Promise<Listener> {
    const protocol = certificate ? 'https' : 'http'
    const baseURL = options.baseURL || '/'
    const formatURL = (host: string) => formatDisplayURL(protocol, host, address.port, baseURL)

    const anyHost = ANY_HOSTS.has(hostname)
    const url = formatURL(anyHost ? 'localhost' : hostname)

    if (announce && options.tunnel) {
      const { startTunnel } = await import('./tunnel')
      tunnel = await startTunnel(`${protocol}://localhost:${address.port}`, !!certificate)
    }

    const tunnelURL = tunnel?.url && tunnel.url + baseURL
    const portless = resolvePortlessURLs()
    const portlessURL = portless.url && portless.url + baseURL
    const portlessShareURL = portless.shareURL && portless.shareURL + baseURL
    const stackblitzURL = resolveStackblitzURL()

    function getURLs(): ListenURL[] {
      const urls: ListenURL[] = []
      if (tunnelURL) {
        urls.push({ url: tunnelURL, type: 'tunnel' })
      }
      for (const portlessURL of portless.all) {
        urls.push({ url: portlessURL + baseURL, type: 'public' })
      }
      if (stackblitzURL) {
        urls.push({ url: stackblitzURL, type: 'public' })
      }
      if (anyHost) {
        urls.push({ url: formatURL('localhost'), type: 'local' })
        for (const address of getNetworkAddresses()) {
          urls.push({ url: formatURL(address), type: 'network' })
        }
      }
      else {
        urls.push({ url, type: 'local' })
      }
      return urls
    }

    // The StackBlitz URL points at the editor rather than at a host another
    // device can open, so it is not a QR code candidate.
    const shareableURL = options.publicURL || tunnelURL || portlessShareURL || portlessURL
    const publicURL = shareableURL || stackblitzURL

    const qrURL = options.qr === false
      ? undefined
      : shareableURL
        || getURLs().find(({ type }) => type === 'network')?.url
        || (options.qr ? url : undefined)

    function showURLs({ qr = false }: { qr?: boolean } = {}): void {
      const urls = getURLs()
      const labels = { local: 'Local:', network: 'Network:', tunnel: 'Tunnel:', public: 'Public:' } as const
      const labelColors = { local: 'green', network: 'magenta', tunnel: 'cyan', public: 'magenta' } as const
      const lines: string[] = []
      const line = (color: (text: string) => string, label: string, value: string, isQR: boolean) =>
        `  ${color('➜')} ${styleText('bold', color(label.padEnd(10)))}${value}${isQR ? styleText('gray', ' [QR code]') : ''}`
      for (const { url: displayURL, type } of urls) {
        lines.push(line(text => styleText(labelColors[type], text), labels[type], styleText('cyan', displayURL), qr && displayURL === qrURL))
      }
      if (!anyHost && !tunnel && !portless.url && !stackblitzURL) {
        const isolated = LOOPBACK_HOSTS.has(hostname) ? detectIsolatedEnvironment() : undefined
        const hint = isolated
          ? `use ${styleText('white', '--host')} to reach this server from outside ${isolated}`
          : `use ${styleText('white', '--host')} to expose`
        lines.push(line(text => styleText('magenta', text), 'Network:', styleText('gray', hint), false))
      }
      if (publicURL && publicURL !== url && !urls.some(entry => entry.url === publicURL)) {
        lines.push(line(text => styleText('magenta', text), 'Public:', styleText('cyan', publicURL), qr && publicURL === qrURL))
      }
      // eslint-disable-next-line no-console
      console.log(`${qr ? '' : '\n'}${lines.join('\n')}\n`)
    }

    if (announce) {
      if (options.showURL !== false) {
        if (qrURL) {
          await printQRCode(qrURL)
        }
        showURLs({ qr: !!qrURL })
      }

      if (options.clipboard) {
        await copyURL(publicURL || url)
      }

      if (options.open) {
        openBrowser(options.openURL ? resolveOpenURL(options.openURL, url) : url)
      }
    }

    return {
      url,
      publicURL,
      qrURL,
      address,
      server,
      https: certificate,
      getURLs,
      showURLs,
      close: () => Promise.all([
        tunnel?.close(),
        closeServer(server),
      ]).then(() => {}),
    }
  }
}

/** Bind and announce in one step, for callers that already know their config. */
export async function listen(handler: RequestListener, options: ListenOptions = {}): Promise<Listener> {
  const bound = await bindListener(handler, options)
  try {
    return await createListener(bound, options)
  }
  catch (error) {
    await closeServer(bound.server).catch(() => {})
    throw error
  }
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let forceClose: NodeJS.Timeout | undefined
    server.close((error) => {
      if (forceClose) {
        clearTimeout(forceClose)
      }
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    })
    // Sockets waiting on keep-alive are closed at once, so shutdown is only
    // delayed while a request is actually being served.
    server.closeIdleConnections?.()
    forceClose = setTimeout(() => server.closeAllConnections?.(), CONNECTION_DRAIN_TIMEOUT_MS)
    forceClose.unref()
  })
}

function bindServer(server: HttpServer, port: number, hostname: string, reusePort: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (reusePort && isUnsupportedOptionError(error)) {
        debug('`reusePort` is unsupported on this platform, binding without it:', error)
        bindServer(server, port, hostname, false).then(resolve, reject)
        return
      }
      reject(error)
    }
    server.once('error', onError)
    try {
      server.listen({ port, host: hostname || undefined, reusePort, exclusive: !reusePort }, () => {
        server.removeListener('error', onError)
        resolve()
      })
    }
    catch (error) {
      // Runtimes that do not know the option reject it before the bind, throwing
      // rather than emitting `error`.
      server.removeListener('error', onError)
      onError(error as NodeJS.ErrnoException)
    }
  })
}

/**
 * Whether the platform rejected the `reusePort` listen option itself, as opposed
 * to refusing this particular bind. Linux reports `ENOTSUP`, Windows `EINVAL`,
 * and Node validates the option before the bind on runtimes without support.
 */
function isUnsupportedOptionError(error: NodeJS.ErrnoException): boolean {
  return error.code === 'ENOTSUP' || error.code === 'EINVAL' || error.code === 'ERR_INVALID_ARG_VALUE'
}

let reusePortSupport: Promise<boolean> | undefined

/**
 * Whether two sockets can bind the same port at once via `SO_REUSEPORT`, probed
 * on an ephemeral port. A single successful bind is not enough: some platforms
 * accept the option and still reject the second socket. Support is a property of
 * the platform rather than of an address, so the loopback probe stands in for
 * whichever hostname the dev server ends up binding. Cached per process.
 */
export function isReusePortSupported(): Promise<boolean> {
  reusePortSupport ??= (async () => {
    const first = createHttpServer()
    const second = createHttpServer()
    try {
      await bindServer(first, 0, '127.0.0.1', true)
      const { port } = first.address() as AddressInfo
      await bindServer(second, port, '127.0.0.1', true)
      return true
    }
    catch (error) {
      debug('`reusePort` is not available:', error)
      return false
    }
    finally {
      for (const server of [first, second]) {
        if (server.listening) {
          server.close()
        }
      }
    }
  })()
  return reusePortSupport
}

export function parsePort(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ActionableError(`Invalid port \`${value}\`; expected an integer between 0 and 65535.`)
  }
  return port
}

async function resolvePort(requestedPort: number | undefined, hostname: string, strictPort?: boolean): Promise<number> {
  if (requestedPort === 0) {
    return getPort({ random: true, host: hostname || undefined })
  }

  if (strictPort) {
    return requestedPort ?? 3000
  }

  const port = await getPort({
    port: requestedPort,
    alternativePortRange: [3000, 3100],
    host: hostname || undefined,
  })
  if (requestedPort && port !== requestedPort) {
    logger.warn(`Port ${requestedPort} is in use, using port ${port} instead.`)
  }
  return port
}

/**
 * Turn a `listen()` failure into actionable advice, leaving anything we have
 * nothing better to say about untouched.
 */
function describeBindError(error: NodeJS.ErrnoException, port: number, hostname: string, strictPort?: boolean): Error {
  switch (error.code) {
    case 'EADDRINUSE':
      return new Error(
        strictPort
          ? `Port ${port} is already in use (\`--strictPort\` is enabled).`
          : `Port ${port} is already in use.`,
        { cause: error },
      )
    case 'EACCES':
      return new Error(`Port ${port} requires elevated privileges. Pass \`--port\` with a port above 1023.`, { cause: error })
    case 'EADDRNOTAVAIL':
      return new Error(`\`${hostname}\` is not an address of this machine. Pass \`--host\` with a local address, or omit it to listen on localhost.`, { cause: error })
    case 'ENOTFOUND':
      return new Error(`\`${hostname}\` could not be resolved. Pass \`--host\` with a local address, or omit it to listen on localhost.`, { cause: error })
  }
  return error
}

export async function printQRCode(url: string, { showURL = false }: { showURL?: boolean } = {}): Promise<void> {
  const { renderUnicodeCompact } = await import('uqr')
  const caption = showURL ? `\n${centerBlock(styleText('cyan', url), url.length)}` : ''
  // eslint-disable-next-line no-console
  console.log(`\n${centerBlock(renderUnicodeCompact(url))}${caption}\n`)
}

export async function copyURL(url: string): Promise<void> {
  if (!hasDisplayServer()) {
    logger.warn('No clipboard is available in this environment.')
    return
  }
  try {
    const { writeText } = await import('tinyclip')
    await writeText(url)
    logger.info('URL copied to clipboard.')
  }
  catch (error) {
    debug('Failed to copy URL to clipboard:', error)
    logger.warn('Could not copy the URL to the clipboard.')
  }
}

const DISPLAY_REQUIRED_PLATFORMS = new Set<NodeJS.Platform>(['linux', 'freebsd', 'openbsd'])

/**
 * Whether a graphical session exists to receive a clipboard write or a browser
 * launch. The tools involved on Linux and BSD (`wl-copy`, `xsel`, `xclip`,
 * `xdg-open`) all need one, and fail in unhelpful ways without it: clipboard
 * tools exit before reading their input, so the write fails with `EPIPE`.
 */
function hasDisplayServer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!DISPLAY_REQUIRED_PLATFORMS.has(process.platform)) {
    return true
  }
  return !!(env.WSL_DISTRO_NAME || env.WAYLAND_DISPLAY || env.DISPLAY)
}

function centerBlock(block: string, blockWidth?: number): string {
  const lines = block.split('\n')
  const width = blockWidth ?? Math.max(...lines.map(line => line.length))
  const columns = Math.min(process.stdout.columns || 80, 80)
  const indent = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)))
  return lines.map(line => indent + line).join('\n')
}

export function resolveOpenURL(target: string, baseURL: string): string {
  try {
    return new URL(target, baseURL).href
  }
  catch {
    logger.warn(`Ignoring invalid \`--open.url\` value: ${target}`)
    return baseURL
  }
}

const DEFAULT_LAUNCHERS = new Set(['open', 'xdg-open', 'start', 'cmd', 'cmd.exe'])

/**
 * Resolve the command that opens `url`, honouring the de facto `BROWSER` and
 * `BROWSER_ARGS` environment variables (`BROWSER=none` disables opening).
 */
export function resolveOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): [command: string, args: string[]] | undefined {
  const browser = env.BROWSER?.trim()
  if (browser === 'none') {
    return
  }

  // A `BROWSER` naming the platform launcher itself is asking for the default
  // behaviour, not for a browser called `open`/`xdg-open` (`open -a open <url>`
  // fails).
  if (browser && !DEFAULT_LAUNCHERS.has(browser)) {
    const browserArgs = env.BROWSER_ARGS?.trim().split(/\s+/).filter(Boolean) ?? []
    return platform === 'darwin' && !browser.includes('/')
      ? ['open', ['-a', browser, url, ...(browserArgs.length > 0 ? ['--args', ...browserArgs] : [])]]
      : [browser, [...browserArgs, url]]
  }

  if (platform === 'darwin') {
    return ['open', [url]]
  }
  // `cmd /c start` owns the arcane quoting rules; `""` is a dummy window title
  // (otherwise `start` treats a quoted URL as one), and `&`/`^` need escaping.
  // WSL reports itself as Linux but has no X server, so `xdg-open` fails there;
  // `cmd.exe` opens the browser on the Windows side instead.
  if (platform === 'win32' || isWsl(platform, env)) {
    return ['cmd.exe', ['/c', 'start', '""', url.replace(/[&^]/g, '^$&')]]
  }
  return ['xdg-open', [url]]
}

/** How long a launcher has to fail before we assume the browser did open. */
const BROWSER_LAUNCH_TIMEOUT_MS = 3000

export function openBrowser(url: string): void {
  const resolved = resolveOpenCommand(url)
  if (!resolved) {
    return
  }
  if (!hasDisplayServer()) {
    logger.warn(`No browser is available in this environment. Open ${styleText('cyan', url)} manually.`)
    return
  }

  const [command, args] = resolved
  const onFailure = (error: unknown) => {
    debug('Failed to open browser:', error)
    logger.warn(`Could not open ${styleText('cyan', url)} in a browser.`)
  }

  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.once('error', onFailure)
    const onExit = (code: number | null) => {
      if (code) {
        onFailure(new Error(`\`${command}\` exited with code ${code}`))
      }
    }
    child.once('exit', onExit)
    // `BROWSER` may point at the browser itself rather than a launcher, in which
    // case the process lives as long as the browser does and its eventual exit
    // code says nothing about whether the URL opened.
    setTimeout(() => child.off('exit', onExit), BROWSER_LAUNCH_TIMEOUT_MS).unref()
    child.unref()
  }
  catch (error) {
    onFailure(error)
  }
}
