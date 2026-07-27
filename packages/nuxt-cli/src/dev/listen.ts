import type { Server as HttpServer, RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HTTPSOptions, ResolvedCertificate } from './cert'
import type { Tunnel } from './tunnel'

import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { networkInterfaces, release } from 'node:os'
import process from 'node:process'

import { getPort } from 'get-port-please'
import colors from 'picocolors'

import { debug, logger } from '../utils/logger'
import { resolveCertificate } from './cert'
import { resolvePortlessURLs } from './portless'
import { startTunnel } from './tunnel'

export interface ListenOptions {
  port?: string | number
  /** Fail instead of falling back to another port when `port` is unavailable. */
  strictPort?: boolean
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

const HOSTNAME_RE = /^(?!-)[\d.:a-z-]{1,253}(?<!-)$/i

/**
 * Check `hostname` is a plausible host or IP address, falling back to a
 * bindable default (with a warning) when it is not.
 */
export function validateHostname(hostname: string | undefined, isPublic?: boolean): string | undefined {
  const isValid = !!hostname
    && HOSTNAME_RE.test(hostname)
    && hostname.split('.').every(label => label.length <= 63)
  if (!hostname || isValid) {
    return hostname
  }
  const fallback = isPublic ? '' : 'localhost'
  logger.warn(`Invalid host \`${hostname}\`, using \`${fallback || '0.0.0.0'}\` instead.`)
  return fallback
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

export async function listen(handler: RequestListener, options: ListenOptions = {}): Promise<Listener> {
  const hostname = validateHostname(options.hostname, options.public) ?? (options.public ? '' : 'localhost')

  const requestedPort = options.port === undefined || options.port === '' ? undefined : Number(options.port)
  const port = await resolvePort(requestedPort, hostname, options.strictPort)

  const httpsOptions = options.https === true ? {} : options.https
  const certificate = httpsOptions ? await resolveCertificate(httpsOptions) : false
  const server = certificate
    ? createSecureServer(certificate, handler)
    : createHttpServer(handler)

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => reject(describeBindError(error, port, hostname, options.strictPort))
    server.once('error', onError)
    server.listen(port, hostname || undefined, () => {
      server.removeListener('error', onError)
      // Without a persistent handler, any later `error` event is unhandled and
      // takes the whole dev process down.
      server.on('error', error => logger.error(`Dev server error: ${error.message}`))
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  const protocol = certificate ? 'https' : 'http'
  const baseURL = options.baseURL || '/'
  const formatURL = (host: string) => `${protocol}://${host.includes(':') ? `[${host}]` : host}:${address.port}${baseURL}`

  const anyHost = ANY_HOSTS.has(hostname)
  const url = formatURL(anyHost ? 'localhost' : hostname)

  let tunnel: Tunnel | undefined
  if (options.tunnel) {
    tunnel = await startTunnel(`${protocol}://localhost:${address.port}`, !!certificate)
  }

  const portless = resolvePortlessURLs()
  const portlessURL = portless.url && portless.url + baseURL
  const portlessShareURL = portless.shareURL && portless.shareURL + baseURL

  function getURLs(): ListenURL[] {
    const urls: ListenURL[] = []
    if (tunnel) {
      urls.push({ url: tunnel.url, type: 'tunnel' })
    }
    for (const portlessURL of portless.all) {
      urls.push({ url: portlessURL + baseURL, type: 'public' })
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

  const publicURL = options.publicURL || tunnel?.url || portlessShareURL || portlessURL

  const qrURL = options.qr === false
    ? undefined
    : publicURL
      || getURLs().find(({ type }) => type === 'network')?.url
      || (options.qr ? url : undefined)

  function showURLs({ qr = false }: { qr?: boolean } = {}): void {
    const urls = getURLs()
    const labels = { local: 'Local:', network: 'Network:', tunnel: 'Tunnel:', public: 'Public:' } as const
    const labelColors = { local: colors.green, network: colors.magenta, tunnel: colors.cyan, public: colors.magenta } as const
    const lines: string[] = []
    const line = (color: (text: string) => string, label: string, value: string, isQR: boolean) =>
      `  ${color('➜')} ${colors.bold(color(label.padEnd(10)))}${value}${isQR ? colors.gray(' [QR code]') : ''}`
    for (const { url: displayURL, type } of urls) {
      lines.push(line(labelColors[type], labels[type], colors.cyan(displayURL), qr && displayURL === qrURL))
    }
    if (!anyHost && !tunnel && !portless.url) {
      lines.push(line(colors.magenta, 'Network:', colors.gray(`use ${colors.white('--host')} to expose`), false))
    }
    if (publicURL && publicURL !== url && !urls.some(entry => entry.url === publicURL)) {
      lines.push(line(colors.magenta, 'Public:', colors.cyan(publicURL), qr && publicURL === qrURL))
    }
    // eslint-disable-next-line no-console
    console.log(`${qr ? '' : '\n'}${lines.join('\n')}\n`)
  }

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

  return {
    url,
    publicURL,
    qrURL,
    address,
    server,
    https: certificate,
    getURLs,
    showURLs,
    close: async () => {
      await tunnel?.close()
      return new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        server.closeAllConnections?.()
      })
    },
  }
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
  const caption = showURL ? `\n${centerBlock(colors.cyan(url), url.length)}` : ''
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

function resolveOpenURL(target: string, baseURL: string): string {
  try {
    return new URL(target, baseURL).href
  }
  catch {
    logger.warn(`Ignoring invalid \`--open.url\` value: ${target}`)
    return baseURL
  }
}

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

  if (browser) {
    const browserArgs = env.BROWSER_ARGS?.trim().split(/\s+/).filter(Boolean) ?? []
    return platform === 'darwin' && !browser.includes('/')
      ? ['open', ['-a', browser, url, ...(browserArgs.length > 0 ? ['--args', ...browserArgs] : [])]]
      : [browser, [...browserArgs, url]]
  }

  // WSL reports itself as Linux but has no X server, so `xdg-open` fails there;
  // `cmd.exe` opens the browser on the Windows side instead. WSL1 spells the
  // release `Microsoft`, WSL2 `microsoft-standard-WSL2`.
  const isWSL = platform === 'linux'
    && (!!env.WSL_DISTRO_NAME || release().toLowerCase().includes('microsoft'))

  if (platform === 'darwin') {
    return ['open', [url]]
  }
  // `cmd /c start` owns the arcane quoting rules; `""` is a dummy window title
  // (otherwise `start` treats a quoted URL as one), and `&`/`^` need escaping.
  if (platform === 'win32' || isWSL) {
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
    logger.warn(`No browser is available in this environment. Open ${colors.cyan(url)} manually.`)
    return
  }

  const [command, args] = resolved
  const onFailure = (error: unknown) => {
    debug('Failed to open browser:', error)
    logger.warn(`Could not open ${colors.cyan(url)} in a browser.`)
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
