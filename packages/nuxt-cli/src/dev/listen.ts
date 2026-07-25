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
  hostname?: string
  baseURL?: string
  showURL?: boolean
  open?: boolean
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
  address: AddressInfo
  server: HttpServer
  https: false | ResolvedCertificate
  close: () => Promise<void>
  getURLs: () => ListenURL[]
}

const ANY_HOSTS = new Set(['', '0.0.0.0', '::'])

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
  const hostname = options.hostname ?? (options.public ? '' : 'localhost')

  const requestedPort = options.port === undefined || options.port === '' ? undefined : Number(options.port)
  const port = requestedPort === 0
    ? await getPort({ random: true, host: hostname || undefined })
    : await getPort({
        port: requestedPort,
        alternativePortRange: [3000, 3100],
        host: hostname || undefined,
      })
  if (requestedPort && port !== requestedPort) {
    logger.warn(`Port ${requestedPort} is in use, using port ${port} instead.`)
  }

  const httpsOptions = options.https === true ? {} : options.https
  const certificate = httpsOptions ? await resolveCertificate(httpsOptions) : false
  const server = certificate
    ? createSecureServer(certificate, handler)
    : createHttpServer(handler)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, hostname || undefined, () => {
      server.removeListener('error', reject)
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
      for (const info of Object.values(networkInterfaces()).flat()) {
        if (!info || info.internal || info.family !== 'IPv4') {
          continue
        }
        urls.push({ url: formatURL(info.address), type: 'network' })
      }
    }
    else {
      urls.push({ url, type: 'local' })
    }
    return urls
  }

  const publicURL = options.publicURL || tunnel?.url || portlessShareURL || portlessURL

  if (options.showURL !== false) {
    const urls = getURLs()
    const qrURL = options.qr === false
      ? undefined
      : publicURL
        || urls.find(({ type }) => type === 'network')?.url
        || (options.qr ? url : undefined)

    if (qrURL) {
      const { renderUnicodeCompact } = await import('uqr')
      // eslint-disable-next-line no-console
      console.log(`\n${centerBlock(renderUnicodeCompact(qrURL))}\n`)
    }

    const labels = { local: 'Local:', network: 'Network:', tunnel: 'Tunnel:', public: 'Public:' } as const
    const labelColors = { local: colors.green, network: colors.magenta, tunnel: colors.cyan, public: colors.magenta } as const
    const lines: string[] = []
    const line = (color: (text: string) => string, label: string, value: string, isQR: boolean) =>
      `  ${color('➜')} ${colors.bold(color(label.padEnd(10)))}${value}${isQR ? colors.gray(' [QR code]') : ''}`
    for (const { url: displayURL, type } of urls) {
      lines.push(line(labelColors[type], labels[type], colors.cyan(displayURL), displayURL === qrURL))
    }
    if (!anyHost && !tunnel && !portless.url) {
      lines.push(line(colors.magenta, 'Network:', colors.gray(`use ${colors.white('--host')} to expose`), false))
    }
    if (publicURL && publicURL !== url && !urls.some(entry => entry.url === publicURL)) {
      lines.push(line(colors.magenta, 'Public:', colors.cyan(publicURL), publicURL === qrURL))
    }
    // eslint-disable-next-line no-console
    console.log(`${qrURL ? '' : '\n'}${lines.join('\n')}\n`)
  }

  if (options.clipboard) {
    try {
      const { writeText } = await import('tinyclip')
      await writeText(publicURL || url)
      logger.info('URL copied to clipboard.')
    }
    catch (error) {
      debug('Failed to copy URL to clipboard:', error)
    }
  }

  if (options.open) {
    openBrowser(url)
  }

  return {
    url,
    address,
    server,
    https: certificate,
    getURLs,
    close: async () => {
      await tunnel?.close()
      return new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        server.closeAllConnections?.()
      })
    },
  }
}

function centerBlock(block: string): string {
  const lines = block.split('\n')
  const width = Math.max(...lines.map(line => line.length))
  const columns = Math.min(process.stdout.columns || 80, 80)
  const indent = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)))
  return lines.map(line => indent + line).join('\n')
}

function openBrowser(url: string): void {
  // WSL reports itself as Linux but has no X server, so `xdg-open` fails there;
  // `cmd.exe` opens the browser on the Windows side instead. WSL1 spells the
  // release `Microsoft`, WSL2 `microsoft-standard-WSL2`.
  const isWSL = process.platform === 'linux'
    && (!!process.env.WSL_DISTRO_NAME || release().toLowerCase().includes('microsoft'))

  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]]
    // `cmd /c start` owns the arcane quoting rules; `""` is a dummy window title
    // (otherwise `start` treats a quoted URL as one), and `&`/`^` need escaping.
    : process.platform === 'win32' || isWSL
      ? ['cmd.exe', ['/c', 'start', '""', url.replace(/[&^]/g, '^$&')]]
      : ['xdg-open', [url]] satisfies [string, string[]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', error => debug('Failed to open browser:', error)).unref()
  }
  catch (error) {
    debug('Failed to open browser:', error)
  }
}
