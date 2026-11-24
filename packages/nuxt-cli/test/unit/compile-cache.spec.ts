import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const binPath = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))
const probePath = fileURLToPath(new URL('./fixtures/compile-cache-probe.mjs', import.meta.url))

interface ProbeResult {
  directory: string
  portable: string
}

function runBin(env: NodeJS.ProcessEnv, bin = binPath): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      ...env,
    }
    if (!('NODE_COMPILE_CACHE_PORTABLE' in env)) {
      delete childEnv.NODE_COMPILE_CACHE_PORTABLE
    }
    const child = spawn(process.execPath, [
      '--import',
      probePath,
      bin,
      '--version',
    ], {
      env: childEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => stderr += chunk)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`\`nuxi --version\` exited with ${signal ?? code}: ${stderr}`))
        return
      }
      resolve({
        directory: stderr.match(/CACHEDIR=(.*)/)?.[1]?.trim() ?? 'none',
        portable: stderr.match(/PORTABLE=(.*)/)?.[1]?.trim() ?? 'unset',
      })
    })
  })
}

async function installBin(root: string, packageDir: string): Promise<string> {
  const dir = join(root, packageDir)
  await mkdir(join(dir, 'bin'), { recursive: true })
  await mkdir(join(dir, 'dist'), { recursive: true })
  await copyFile(binPath, join(dir, 'bin', 'nuxi.mjs'))
  await writeFile(join(dir, 'dist', 'index.mjs'), 'export function runMain() {}\n')
  return join(dir, 'bin', 'nuxi.mjs')
}

describe.skipIf(process.platform === 'win32')('compile cache', () => {
  let scratch: string
  let home: string
  let blockedTmp: string
  let project: string

  beforeEach(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), 'nuxi-compile-cache-')))
    home = join(scratch, 'home')
    blockedTmp = join(scratch, 'tmp')
    project = join(scratch, 'project')
    await mkdir(home, { recursive: true })
    await mkdir(blockedTmp, { recursive: true })
    await mkdir(project, { recursive: true })
  })

  afterEach(async () => {
    await chmod(blockedTmp, 0o700).catch(() => {})
    await chmod(join(project, 'node_modules'), 0o700).catch(() => {})
    await rm(scratch, { recursive: true, force: true })
  })

  it('should use the default cache directory when it is writable', async () => {
    const { directory } = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' })
    expect(directory.startsWith(blockedTmp)).toBe(true)
  })

  it('should fall back to a per-user directory when the shared default is unwritable', async () => {
    await chmod(blockedTmp, 0o500)
    const { directory } = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' })
    expect(directory.startsWith(join(home, '.cache', 'nuxt', 'compile-cache'))).toBe(true)
  })

  it('should stay disabled when `NODE_DISABLE_COMPILE_CACHE` is set', async () => {
    const bin = await installBin(project, 'node_modules/@nuxt/cli')
    const { directory } = await runBin({
      TMPDIR: blockedTmp,
      HOME: home,
      NODE_DISABLE_COMPILE_CACHE: '1',
      NODE_COMPILE_CACHE: '',
    }, bin)
    expect(directory).toBe('none')
  })

  it('should use a portable cache in the `node_modules` the CLI is installed in', async () => {
    const bin = await installBin(project, 'node_modules/@nuxt/cli')
    const result = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' }, bin)
    expect(result.directory.startsWith(join(project, 'node_modules', '.cache', 'nuxt', 'compile-cache'))).toBe(true)
    expect(result.portable).toBe('1')
  })

  it('should use the outermost `node_modules` for isolated installs', async () => {
    const bin = await installBin(project, 'node_modules/.pnpm/@nuxt+cli@4.0.0/node_modules/@nuxt/cli')
    const { directory } = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' }, bin)
    expect(directory.startsWith(join(project, 'node_modules', '.cache', 'nuxt', 'compile-cache'))).toBe(true)
  })

  it('should keep a user-set `NODE_COMPILE_CACHE_PORTABLE`', async () => {
    const bin = await installBin(project, 'node_modules/@nuxt/cli')
    const result = await runBin({
      TMPDIR: blockedTmp,
      HOME: home,
      NODE_COMPILE_CACHE: '',
      NODE_COMPILE_CACHE_PORTABLE: '0',
    }, bin)
    expect(result.directory.startsWith(join(project, 'node_modules', '.cache', 'nuxt', 'compile-cache'))).toBe(true)
    expect(result.portable).toBe('0')
  })

  it('should keep a user-set `NODE_COMPILE_CACHE`', async () => {
    const bin = await installBin(project, 'node_modules/@nuxt/cli')
    const userCache = join(scratch, 'user-cache')
    const result = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: userCache }, bin)
    expect(result.directory.startsWith(userCache)).toBe(true)
    expect(result.portable).toBe('unset')
  })

  it('should fall back to the default directory when `node_modules` is unwritable', async () => {
    const bin = await installBin(project, 'node_modules/@nuxt/cli')
    await chmod(join(project, 'node_modules'), 0o500)
    const result = await runBin({ TMPDIR: blockedTmp, HOME: home, NODE_COMPILE_CACHE: '' }, bin)
    expect(result.directory.startsWith(blockedTmp)).toBe(true)
    expect(result.portable).toBe('unset')
  })
})
