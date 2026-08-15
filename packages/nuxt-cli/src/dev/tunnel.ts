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
