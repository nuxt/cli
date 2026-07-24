import type { Buffer } from 'node:buffer'

import { spawn } from 'node:child_process'
import process from 'node:process'

import { debug, logger } from '../utils/logger'
import { resolveTool } from './binaries'

const TUNNEL_URL_RE = /https:\/\/(?!api\.)[\w-]+\.trycloudflare\.com/

export interface Tunnel {
  url: string
  close: () => void
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
  const url = await new Promise<string | undefined>((resolve) => {
    const timeout = setTimeout(resolve, 20_000, undefined)
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
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
    logger.warn('Could not establish a Cloudflare quick tunnel. Run with `DEBUG=nuxi` for details.')
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
      child.kill()
    }
    catch {
      // process may have already exited
    }
  }
  process.once('exit', kill)

  return {
    url,
    close: () => {
      process.removeListener('exit', kill)
      kill()
    },
  }
}

async function resolveCloudflared(): Promise<string | undefined> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download'
  const asset = ({
    darwin: `cloudflared-darwin-${arch}.tgz`,
    linux: `cloudflared-linux-${arch}`,
    win32: `cloudflared-windows-amd64.exe`,
  } as Record<string, string>)[process.platform]
  return resolveTool('cloudflared', {
    url: asset && `${base}/${asset}`,
    archive: asset?.endsWith('.tgz'),
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
