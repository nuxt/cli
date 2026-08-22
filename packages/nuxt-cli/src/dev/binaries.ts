import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'

import process from 'node:process'

import { confirm, isCancel, progress, spinner } from '@clack/prompts'
import { basename, dirname, join } from 'pathe'
import { readUser, updateUser } from 'rc9'

import { getCacheDir } from '../utils/cache'
import { restoreRawMode, withDirectStdout } from '../utils/console'
import { debug, logger } from '../utils/logger'
import { logNetworkError } from '../utils/network'
import { findInPath } from '../utils/path-env'
import { withStartupClockPaused } from '../utils/startup-clock'

interface ConsentOptions {
  /** Key under `tools` in the user `.nuxtrc` used to persist acceptance. */
  key: string
  /** Lines shown before the prompt, e.g. license/terms links. */
  notice: string[]
  /** The yes/no question. */
  message: string
  /** Warning shown when running non-interactively (no TTY). */
  nonInteractiveWarning: string
}

/**
 * Resolve a third-party tool binary: from `PATH`, then the download cache,
 * then (with the user's consent) by downloading it.
 *
 * `cacheName` overrides the cached filename, so version-pinned tools can key
 * their cache entry by version without affecting the `PATH` lookup.
 */
export function resolveTool(name: string, options: { url?: string, archive?: boolean, cacheName?: string, consent: ConsentOptions }): Promise<string | undefined> {
  // The consent prompt and the download indicator both redraw by moving the
  // cursor, so they need stdout back from consola for the duration.
  return withDirectStdout(() => locateTool(name, options))
}

async function locateTool(name: string, options: { url?: string, archive?: boolean, cacheName?: string, consent: ConsentOptions }): Promise<string | undefined> {
  const existing = findInPath(name)
  if (existing) {
    return existing
  }
  const cacheName = options.cacheName || name
  const cacheDir = getCacheDir('bin')
  const destination = join(cacheDir, process.platform === 'win32' ? `${cacheName}.exe` : cacheName)
  if (dirname(destination) !== cacheDir) {
    debug(`Refusing to cache \`${name}\` outside ${cacheDir}.`)
    return undefined
  }
  if (existsSync(destination)) {
    return destination
  }
  const { url } = options
  if (!url) {
    return undefined
  }
  // A first-run consent prompt and download can dwarf the server's own
  // startup, so neither counts towards the reported time to ready.
  return withStartupClockPaused(async () => {
    if (!await confirmToolInstall(options.consent)) {
      return undefined
    }
    return downloadBinary(url, destination, { archive: options.archive, name })
  })
}

/**
 * Ask the user to accept a third-party tool's terms before downloading it, and
 * remember their answer in the user-level `.nuxtrc` so we only ever ask once.
 */
async function confirmToolInstall(options: ConsentOptions): Promise<boolean> {
  try {
    if ((readUser('.nuxtrc').tools as Record<string, { termsAccepted?: boolean }> | undefined)?.[options.key]?.termsAccepted) {
      return true
    }
  }
  catch (error) {
    debug('Failed to read user .nuxtrc:', error)
  }

  if (!process.stdout.isTTY) {
    logger.warn(options.nonInteractiveWarning)
    return false
  }

  logger.message(options.notice.join('\n'))
  const agreed = await confirm({ message: options.message })
  restoreRawMode()
  if (isCancel(agreed) || agreed !== true) {
    return false
  }

  try {
    updateUser({ tools: { [options.key]: { termsAccepted: true } } }, '.nuxtrc')
  }
  catch (error) {
    debug('Failed to update user .nuxtrc:', error)
  }
  return true
}

const RESPONSE_TIMEOUT_MS = 30_000

async function downloadBinary(url: string, destination: string, options: { archive?: boolean, name?: string } = {}): Promise<string | undefined> {
  const label = options.name || url
  try {
    // The deadline covers connecting and headers only; once bytes are flowing the
    // progress indicator gives the user something to judge a stall by.
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    }
    finally {
      clearTimeout(deadline)
    }
    if (!response.ok) {
      throw new Error(`Unexpected response: ${response.status}`)
    }
    const data = await readWithProgress(response, label)
    // Stage the install and rename into place: two dev servers racing to install
    // the same tool would otherwise interleave writes and cache a corrupt binary.
    // Staged inside the cache directory so the rename stays on one filesystem.
    const stagingDir = mkdtempSync(join(dirname(destination), '.staging-'))
    try {
      const staged = join(stagingDir, basename(destination))
      if (options.archive) {
        const archivePath = join(stagingDir, 'archive.tgz')
        writeFileSync(archivePath, data)
        execFileSync('tar', ['-xzf', archivePath, '-C', stagingDir], { stdio: 'ignore' })
        rmSync(archivePath)
        // Archives are named after the tool, not the cache entry.
        const extracted = join(stagingDir, options.name || basename(destination))
        if (extracted !== staged && existsSync(extracted)) {
          renameSync(extracted, staged)
        }
      }
      else {
        writeFileSync(staged, data)
      }
      if (!existsSync(staged)) {
        throw new Error(`Archive did not contain \`${basename(destination)}\``)
      }
      chmodSync(staged, 0o755)
      renameSync(staged, destination)
      return destination
    }
    finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  }
  catch (error) {
    debug(`Failed to download \`${url}\`:`, error)
    logNetworkError(error, { url, level: 'warn', prefix: `Failed to download \`${label}\`.` })
    return undefined
  }
}

/**
 * Read a response body into a buffer, reporting a progress bar when the server
 * declares a `content-length` and an indeterminate spinner otherwise.
 */
async function readWithProgress(response: Response, label: string): Promise<Buffer> {
  const total = Number(response.headers.get('content-length')) || 0
  const message = `Downloading \`${label}\``

  if (!response.body || !process.stdout.isTTY) {
    logger.info(message)
    return Buffer.from(await response.arrayBuffer())
  }

  const indicator = total ? progress({ style: 'heavy', max: total }) : spinner()
  indicator.start(message)

  const chunks: Buffer[] = []
  let downloaded = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk))
      downloaded += chunk.byteLength
      if (total) {
        (indicator as ReturnType<typeof progress>).advance(chunk.byteLength)
      }
      else {
        indicator.message(`${message} (${formatSize(downloaded)})`)
      }
    }
  }
  catch (error) {
    indicator.error(`Failed to download \`${label}\``)
    restoreRawMode()
    throw error
  }

  indicator.stop(`Downloaded \`${label}\` (${formatSize(downloaded)})`)
  restoreRawMode()
  return Buffer.concat(chunks)
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
