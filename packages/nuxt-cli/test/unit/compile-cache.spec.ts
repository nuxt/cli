import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const binPath = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))
const probePath = fileURLToPath(new URL('./fixtures/compile-cache-probe.mjs', import.meta.url))

function runBin(env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', probePath, binPath, '--version'], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => stderr += chunk)
    child.on('error', reject)
    child.on('exit', () => {
      const match = stderr.match(/CACHEDIR=(.*)/)
      resolve(match?.[1]?.trim() ?? 'none')
    })
  })
}

describe.skipIf(process.platform === 'win32')('compile cache', () => {
  let scratch: string
  let home: string
  let blockedTmp: string

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'nuxi-compile-cache-'))
    home = join(scratch, 'home')
    blockedTmp = join(scratch, 'tmp')
    await mkdir(home, { recursive: true })
    await mkdir(blockedTmp, { recursive: true })
  })

  afterEach(async () => {
    await chmod(blockedTmp, 0o700).catch(() => {})
    await rm(scratch, { recursive: true, force: true })
  })

  it('should use the default cache directory when it is writable', async () => {
    const directory = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' })
    expect(directory.startsWith(blockedTmp)).toBe(true)
  })

  it('should fall back to a per-user directory when the shared default is unwritable', async () => {
    await chmod(blockedTmp, 0o500)
    const directory = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' })
    expect(directory.startsWith(join(home, '.cache', 'nuxt', 'compile-cache'))).toBe(true)
  })

  it('should stay disabled when `NODE_DISABLE_COMPILE_CACHE` is set', async () => {
    const directory = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_DISABLE_COMPILE_CACHE: '1', NODE_COMPILE_CACHE: '' })
    expect(directory).toBe('none')
  })
})
