import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { resolveTool } from '../../../src/dev/binaries'
import { logger } from '../../../src/utils/logger'

const BINARY = '#!/bin/sh\necho hello\n'

const consent = {
  key: 'nuxt-test-tool',
  notice: ['terms'],
  message: 'Install it?',
  nonInteractiveWarning: 'Cannot install without a terminal.',
}

let server: ReturnType<typeof createServer>
let origin: string
let requests: string[] = []
let archive: Buffer
let unrelatedArchive: Buffer
let home: string
let cacheHome: string

/** A gzipped tar holding `nuxt-test-tool`, built with the same `tar` the download uses. */
function buildArchive(name: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'nuxt-archive-'))
  try {
    writeFileSync(join(dir, name), BINARY)
    execFileSync('tar', ['-czf', join(dir, 'out.tgz'), '-C', dir, name], { stdio: 'ignore' })
    return readFileSync(join(dir, 'out.tgz'))
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

beforeAll(async () => {
  archive = buildArchive('nuxt-test-tool')
  unrelatedArchive = buildArchive('something-else')

  server = createServer((request, response) => {
    requests.push(request.url!)
    if (request.url === '/binary') {
      response.writeHead(200, { 'content-length': String(Buffer.byteLength(BINARY)) })
      response.end(BINARY)
      return
    }
    if (request.url === '/binary-unsized') {
      response.writeHead(200)
      response.end(BINARY)
      return
    }
    if (request.url === '/archive') {
      response.writeHead(200, { 'content-length': String(archive.byteLength) })
      response.end(archive)
      return
    }
    if (request.url === '/empty-archive') {
      response.writeHead(200, { 'content-length': String(unrelatedArchive.byteLength) })
      response.end(unrelatedArchive)
      return
    }
    response.writeHead(500)
    response.end('nope')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  requests = []
  home = mkdtempSync(join(tmpdir(), 'nuxt-home-'))
  cacheHome = mkdtempSync(join(tmpdir(), 'nuxt-cache-'))
  // `resolveTool` records consent in the user-level `.nuxtrc`, so the directory
  // `rc9` reads it from is pointed at a scratch one rather than the machine's
  // own: it prefers `XDG_CONFIG_HOME`, which is set on some CI images, and falls
  // back to the home directory. `PATH` keeps its real entries because extracting
  // an archive shells out to `tar`.
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('XDG_CONFIG_HOME', home)
  vi.stubEnv('XDG_CACHE_HOME', cacheHome)
  writeFileSync(join(home, '.nuxtrc'), 'tools.nuxt-test-tool.termsAccepted=true\n')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(home, { recursive: true, force: true })
  rmSync(cacheHome, { recursive: true, force: true })
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

function cachedPath(name = 'nuxt-test-tool') {
  return join(cacheHome, 'nuxt', 'bin', process.platform === 'win32' ? `${name}.exe` : name)
}

function download(url: string, options: Parameters<typeof resolveTool>[1] extends infer T ? Partial<T> : never = {}) {
  return resolveTool('nuxt-test-tool', { url: `${origin}${url}`, consent, ...options })
}

describe('resolveTool', () => {
  it('should prefer a tool already on PATH', async () => {
    const dir = join(cacheHome, 'bin')
    mkdirSync(dir, { recursive: true })
    const existing = join(dir, process.platform === 'win32' ? 'nuxt-test-tool.exe' : 'nuxt-test-tool')
    writeFileSync(existing, BINARY)
    chmodSync(existing, 0o755)
    vi.stubEnv('PATH', `${dir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`)

    // Windows spells the extension the way `PATHEXT` does, which is upper case.
    await expect(download('/binary').then(path => path?.toLowerCase())).resolves.toBe(existing.toLowerCase())
    expect(requests).toEqual([])
  })

  it('should download an executable and cache it', async () => {
    await expect(download('/binary')).resolves.toBe(cachedPath())

    expect(readFileSync(cachedPath(), 'utf8')).toBe(BINARY)
    if (process.platform !== 'win32') {
      expect(statSync(cachedPath()).mode & 0o777).toBe(0o755)
    }
  })

  it('should reuse the cached download rather than fetching again', async () => {
    await download('/binary')
    await expect(download('/binary')).resolves.toBe(cachedPath())

    expect(requests).toEqual(['/binary'])
  })

  it('should leave no staging directory behind', async () => {
    await download('/binary')

    expect(readdirSync(join(cacheHome, 'nuxt', 'bin')).filter(name => name.startsWith('.staging'))).toEqual([])
  })

  it('should accept a download whose digest matches', async () => {
    const sha256 = createHash('sha256').update(BINARY).digest('hex')

    await expect(download('/binary', { sha256 })).resolves.toBe(cachedPath())
  })

  it('should discard a download whose digest does not match', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await expect(download('/binary', { sha256: '0'.repeat(64) })).resolves.toBeUndefined()

    expect(readdirSync(join(cacheHome, 'nuxt', 'bin'))).toEqual([])
    expect(warn.mock.calls.flat().join('\n')).toContain('nuxt-test-tool')
  })

  it('should read a body with no declared length', async () => {
    await expect(download('/binary-unsized')).resolves.toBe(cachedPath())

    expect(readFileSync(cachedPath(), 'utf8')).toBe(BINARY)
  })

  it('should extract the binary from an archive', async () => {
    await expect(download('/archive', { archive: true })).resolves.toBe(cachedPath())

    expect(readFileSync(cachedPath(), 'utf8')).toBe(BINARY)
  })

  it('should give up on an archive without the expected binary', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await expect(download('/empty-archive', { archive: true })).resolves.toBeUndefined()

    expect(readdirSync(join(cacheHome, 'nuxt', 'bin'))).toEqual([])
  })

  it('should give up on an error response', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await expect(download('/missing')).resolves.toBeUndefined()

    expect(readdirSync(join(cacheHome, 'nuxt', 'bin'))).toEqual([])
  })

  it('should cache under the name it was given', async () => {
    await expect(download('/binary', { cacheName: 'nuxt-test-tool-1.2.3' })).resolves.toBe(cachedPath('nuxt-test-tool-1.2.3'))
  })

  it('should not download without a url', async () => {
    await expect(resolveTool('nuxt-test-tool', { consent })).resolves.toBeUndefined()

    expect(requests).toEqual([])
  })

  it('should refuse to install without consent when there is no terminal', async () => {
    rmSync(join(home, '.nuxtrc'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const isTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    onTestFinished(() => {
      Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true })
    })

    await expect(download('/binary')).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(consent.nonInteractiveWarning)
    expect(requests).toEqual([])
  })
})
