import type { Buffer } from 'node:buffer'

import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import process from 'node:process'

import { join } from 'pathe'

import { debug, logger } from '../utils/logger'
import { findInPath, getCacheDir, resolveTool } from './binaries'

export interface HTTPSOptions {
  cert?: string
  key?: string
  pfx?: string
  passphrase?: string
  validityDays?: number
  domains?: string[]
}

export interface ResolvedCertificate {
  cert?: string
  key?: string
  pfx?: Buffer
  /** Path the `pfx` buffer was read from, for reporting back to `devServer.https`. */
  pfxPath?: string
  passphrase?: string
}

export async function resolveCertificate(options: HTTPSOptions): Promise<ResolvedCertificate> {
  if (options.pfx) {
    return { pfx: await readFile(options.pfx), pfxPath: options.pfx, passphrase: options.passphrase }
  }
  if (options.cert && options.key) {
    const [cert, key] = await Promise.all([
      readFile(options.cert, 'utf8'),
      readFile(options.key, 'utf8'),
    ])
    return { cert, key, passphrase: options.passphrase }
  }
  return generateCertificate(options)
}

/** Regenerate rather than serve a certificate that expires within the day. */
const CERT_MIN_REMAINING_MS = 24 * 60 * 60 * 1000

async function generateCertificate(options: HTTPSOptions): Promise<ResolvedCertificate> {
  const domains = options.domains?.length ? options.domains : ['localhost', '127.0.0.1', '::1']
  const hash = createHash('sha256').update(domains.join(',')).digest('hex').slice(0, 8)
  const dir = getCacheDir('certs', hash)
  const certPath = join(dir, 'cert.pem')
  const keyPath = join(dir, 'key.pem')

  if (!isCertificateUsable(certPath, keyPath, domains)) {
    const generated = await generateWithMkcert(certPath, keyPath, domains)
      || generateWithOpenssl(certPath, keyPath, domains, options.validityDays)
    if (!generated) {
      throw new Error('Could not generate a development certificate. Install `mkcert` (https://github.com/FiloSottile/mkcert) or provide `--https.cert` and `--https.key`.')
    }
  }

  return {
    cert: await readFile(certPath, 'utf8'),
    key: await readFile(keyPath, 'utf8'),
  }
}

/**
 * A cached certificate is only reusable if it still has meaningful validity
 * left, covers every requested domain, and matches the cached key. Checking the
 * certificate itself means a shorter `--https.validityDays` is respected.
 */
function isCertificateUsable(certPath: string, keyPath: string, domains: string[]): boolean {
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    return false
  }
  try {
    const certificate = new X509Certificate(readFileSync(certPath))
    if (Date.parse(certificate.validTo) - Date.now() < CERT_MIN_REMAINING_MS) {
      return false
    }
    const covered = domains.every(domain => (isIP(domain)
      ? certificate.checkIP(domain) !== undefined
      : certificate.checkHost(domain) !== undefined))
    return covered && certificate.checkPrivateKey(createPrivateKey(readFileSync(keyPath)))
  }
  catch (error) {
    debug('Ignoring unreadable cached certificate:', error)
    return false
  }
}

async function generateWithMkcert(certPath: string, keyPath: string, domains: string[]): Promise<boolean> {
  const binary = await resolveMkcert()
  if (!binary) {
    return false
  }
  try {
    execFileSync(binary, ['-install'], { stdio: ['inherit', 'ignore', 'inherit'] })
    execFileSync(binary, ['-cert-file', certPath, '-key-file', keyPath, ...domains], { stdio: 'ignore' })
    return true
  }
  catch (error) {
    debug('Failed to generate certificate with mkcert:', error)
    return false
  }
}

async function resolveMkcert(): Promise<string | undefined> {
  const platform = ({ darwin: 'darwin', linux: 'linux', win32: 'windows' } as Record<string, string>)[process.platform]
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  return resolveTool('mkcert', {
    url: platform && `https://dl.filippo.io/mkcert/latest?for=${platform}/${arch}`,
    consent: {
      key: 'mkcert',
      notice: [
        '`--https` can install `mkcert` to generate a locally-trusted certificate.',
        'This downloads the `mkcert` binary and adds a local certificate authority to your system trust store.',
        '',
        'Project: https://github.com/FiloSottile/mkcert (BSD-3-Clause)',
      ],
      message: 'Download `mkcert` and install a local certificate authority?',
      nonInteractiveWarning: 'Skipping `mkcert` download (needs interactive consent). Falling back to a self-signed certificate. Install `mkcert` manually for a locally-trusted certificate.',
    },
  })
}

function generateWithOpenssl(certPath: string, keyPath: string, domains: string[], validityDays = 30): boolean {
  if (!findInPath('openssl')) {
    return false
  }
  const altNames = domains.map(domain => (isIP(domain) ? `IP:${domain}` : `DNS:${domain}`)).join(',')
  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      String(validityDays),
      '-subj',
      `/CN=${domains[0]}`,
      '-addext',
      `subjectAltName=${altNames}`,
    ], { stdio: 'ignore' })
    logger.warn('Generated a self-signed certificate. Install `mkcert` for a locally-trusted certificate.')
    return true
  }
  catch (error) {
    debug('Failed to generate certificate with openssl:', error)
    return false
  }
}
