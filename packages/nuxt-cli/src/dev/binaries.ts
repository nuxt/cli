import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'

import process from 'node:process'

import { confirm, isCancel, progress, spinner } from '@clack/prompts'
import { basename, dirname, join } from 'pathe'
import { readUser, updateUser } from 'rc9'

import { debug, logger } from '../utils/logger'
import { describeNetworkError } from '../utils/network'

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
export async function resolveTool(name: string, options: { url?: string, archive?: boolean, cacheName?: string, consent: ConsentOptions }): Promise<string | undefined> {
  const existing = findInPath(name)
  if (existing) {
    return existing
  }
  const cacheName = options.cacheName || name
  const destination = join(getCacheDir('bin'), process.platform === 'win32' ? `${cacheName}.exe` : cacheName)
  if (existsSync(destination)) {
    return destination
  }
  if (!options.url || !await confirmToolInstall(options.consent)) {
    return undefined
  }
  return downloadBinary(options.url, destination, { archive: options.archive, name })
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

export function getCacheDir(...segments: string[]): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  const dir = join(base, 'nuxt', ...segments)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function findInPath(name: string): string | undefined {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) {
      continue
    }
    for (const extension of extensions) {
      const candidate = join(dir, name + extension)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
}

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
    logger.warn(`Failed to download \`${label}\`. ${describeNetworkError(error, url)}`)
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
    throw error
  }

  indicator.stop(`Downloaded \`${label}\` (${formatSize(downloaded)})`)
  return Buffer.concat(chunks)
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
