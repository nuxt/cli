import type { Buffer } from 'node:buffer'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'

import { debug, logger } from '../utils/logger'
import { resolveTool } from './binaries'

const TUNNEL_URL_RE = /https:\/\/(?!api\.)[\w-]+\.trycloudflare\.com/

const DEFAULT_CLOUDFLARED_VERSION = '2026.7.3'
const CLOUDFLARED_VERSION_RE = /^[\w.-]+$/

/**
 * Version of `cloudflared` to download. Pinned so a bad Cloudflare release
 * cannot break `--tunnel` for everyone; `CLOUDFLARED_VERSION` (or `latest`)
 * overrides it.
 *
 * The value reaches both a release URL and a cache filename, so anything that
 * is not a bare version is rejected rather than allowed to traverse either.
 */
export function resolveCloudflaredVersion(version = process.env.CLOUDFLARED_VERSION): string {
  if (!version) {
    return DEFAULT_CLOUDFLARED_VERSION
  }
  if (!CLOUDFLARED_VERSION_RE.test(version)) {
    logger.warn(`Ignoring invalid \`CLOUDFLARED_VERSION\` value \`${version}\`.`)
    return DEFAULT_CLOUDFLARED_VERSION
  }
  return version
}

/** How long to wait for `cloudflared` to exit on `SIGINT` before `SIGKILL`. */
const SHUTDOWN_TIMEOUT_MS = 5000

export interface Tunnel {
  url: string
  close: () => Promise<void>
}

export async function startTunnel(localURL: string, insecure?: boolean): Promise<Tunnel | undefined> {
  const binary = await resolveCloudflared()
  if (!binary) {
    logger.warn('Could not find or download `cloudflared`. Install it to use `--tunnel`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
    return undefined
  }

  const args = ['tunnel', '--url', localURL, '--no-autoupdate']
  if (insecure) {
    args.push('--no-tls-verify')
  }
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let output = ''
  const recentOutput: string[] = []
  const url = await new Promise<string | undefined>((resolve) => {
    const timeout = setTimeout(resolve, 20_000, undefined)
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      for (const line of text.split('\n')) {
        if (line.trim()) {
          recentOutput.push(line.trim())
        }
      }
      if (recentOutput.length > 10) {
        recentOutput.splice(0, recentOutput.length - 10)
      }
      const match = output.match(TUNNEL_URL_RE)
      if (match) {
        clearTimeout(timeout)
        resolve(match[0])
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve(undefined)
    })
    // `spawn` reports exec failures asynchronously; an unhandled `error` event
    // would terminate the dev process.
    child.once('error', (error) => {
      clearTimeout(timeout)
      debug('Failed to spawn `cloudflared`:', error)
      resolve(undefined)
    })
  })

  if (!url) {
    child.kill()
    debug('cloudflared output:', output)
    logger.warn([
      'Could not establish a Cloudflare quick tunnel.',
      ...recentOutput.map(line => `  ${line}`),
    ].join('\n'))
    return undefined
  }

  child.on('error', error => debug('`cloudflared` error:', error))

  // Keep draining the pipes: destroying them makes cloudflared die from EPIPE
  // on its next log write, which silently breaks the tunnel.
  for (const stream of [child.stdout, child.stderr]) {
    stream.removeAllListeners('data')
    stream.resume()
    ;(stream as unknown as { unref?: () => void }).unref?.()
  }
  child.unref()

  const kill = () => {
    try {
      child.kill('SIGKILL')
    }
    catch {
      // process may have already exited
    }
  }
  process.once('exit', kill)

  return {
    url,
    close: async () => {
      process.removeListener('exit', kill)
      if (child.exitCode !== null || child.signalCode !== null) {
        return
      }
      // `SIGINT` lets cloudflared drain its connections and deregister the
      // quick tunnel; escalate if it does not exit promptly.
      const exited = once(child, 'exit')
      child.kill('SIGINT')
      const escalation = setTimeout(kill, SHUTDOWN_TIMEOUT_MS)
      try {
        await exited
      }
      catch (error) {
        debug('Failed to stop `cloudflared`:', error)
      }
      finally {
        clearTimeout(escalation)
      }
    },
  }
}

const CLOUDFLARED_ASSETS: Record<string, Partial<Record<typeof process.arch, string>>> = {
  darwin: {
    arm64: 'cloudflared-darwin-arm64.tgz',
    x64: 'cloudflared-darwin-amd64.tgz',
  },
  linux: {
    arm: 'cloudflared-linux-arm',
    arm64: 'cloudflared-linux-arm64',
    ia32: 'cloudflared-linux-386',
    x64: 'cloudflared-linux-amd64',
  },
  win32: {
    ia32: 'cloudflared-windows-386.exe',
    x64: 'cloudflared-windows-amd64.exe',
  },
}

/**
 * SHA-256 checksums of the {@link DEFAULT_CLOUDFLARED_VERSION} release assets,
 * from the release notes at
 * https://github.com/cloudflare/cloudflared/releases/tag/2026.7.3.
 * Must be updated together with the pinned version. Downloads of an overridden
 * `CLOUDFLARED_VERSION` cannot be verified and are accepted as fetched.
 */
const CLOUDFLARED_SHA256: Record<string, string> = {
  'cloudflared-darwin-arm64.tgz': 'f35c50089cd25f77a4cb5a2152036bc26db15aa31fbe11f7995d2e42a4ed6257',
  'cloudflared-darwin-amd64.tgz': 'e88fe5874d42a94f49a7ea59cabc3722d2962d0449232b0f3b1a426a712e275c',
  'cloudflared-linux-arm': '6dadd979b8833760e9f6d840a6239a8c08c8bcf73b4231ec537f483873f37c73',
  'cloudflared-linux-arm64': '65259e652a7bea08bf5df603233ab22b8bf3116af8df9f9206209af6a1b955c0',
  'cloudflared-linux-386': '6c982e77e644644f5bce76781dd2b69ddc0bfa5e1dd1f55f0037850ac0946771',
  'cloudflared-linux-amd64': '9d71c677db00134c1bd4144b7783486b654ad281b1ea62b4972098d19f770f17',
  'cloudflared-windows-386.exe': 'd026e39d9be21c70ea652528fda2801e164d5e25688b7b0fb3b65080cbd96503',
  'cloudflared-windows-amd64.exe': '8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841',
}

async function resolveCloudflared(): Promise<string | undefined> {
  const CLOUDFLARED_VERSION = resolveCloudflaredVersion()
  const base = CLOUDFLARED_VERSION === 'latest'
    ? 'https://github.com/cloudflare/cloudflared/releases/latest/download'
    : `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`
  const asset = CLOUDFLARED_ASSETS[process.platform]?.[process.arch]
  return resolveTool('cloudflared', {
    url: asset && `${base}/${asset}`,
    archive: asset?.endsWith('.tgz'),
    cacheName: `cloudflared-${CLOUDFLARED_VERSION}`,
    sha256: asset && CLOUDFLARED_VERSION === DEFAULT_CLOUDFLARED_VERSION ? CLOUDFLARED_SHA256[asset] : undefined,
    consent: {
      key: 'cloudflared',
      notice: [
        'Installing `cloudflared` constitutes acceptance of the Cloudflare terms:',
        '',
        'License:        https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/license/',
        'Terms:          https://www.cloudflare.com/terms/',
        'Privacy Policy: https://www.cloudflare.com/privacypolicy/',
      ],
      message: 'Do you agree with the above terms and wish to install `cloudflared`?',
      nonInteractiveWarning: '`--tunnel` requires downloading `cloudflared`, which needs interactive consent to the Cloudflare terms. Install `cloudflared` manually to use tunnels in non-interactive environments.',
    },
  })
}
