import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import process from 'node:process'

import { x } from 'tinyexec'

const DEFAULT_PORTLESS_NAME = 'nuxt-app'

export async function ensurePortlessAvailable(cwd: string) {
  try {
    await runPortless(cwd, ['--version'])
  }
  catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Portless is required for `--portless`. Install it from https://portless.sh')
    }

    throw createPortlessError('check portless availability', error)
  }
}

export async function resolvePortlessURL(cwd: string, name: string) {
  try {
    await runPortless(cwd, ['proxy', 'start'])
    const result = await runPortless(cwd, ['get', name])
    const url = result.stdout.trim()

    if (!url) {
      throw new Error('Portless returned an empty URL')
    }

    return new URL(url).toString().replace(/\/$/, '')
  }
  catch (error) {
    throw createPortlessError('resolve the portless URL', error)
  }
}

export function resolvePortlessAliasName(url: string) {
  const aliasName = new URL(url).hostname.replace(/\.[^.]+$/, '')
  if (!aliasName) {
    throw new Error('Portless returned an invalid hostname')
  }
  return aliasName
}

export async function registerPortlessAlias(cwd: string, name: string, port: number) {
  try {
    await runPortless(cwd, ['alias', name, `${port}`, '--force'])
  }
  catch (error) {
    throw createPortlessError(`register the portless alias for port ${port}`, error)
  }
}

export async function removePortlessAlias(cwd: string, name: string) {
  try {
    await runPortless(cwd, ['alias', '--remove', name])
  }
  catch (error) {
    throw createPortlessError(`remove the portless alias for ${name}`, error)
  }
}

export function registerPortlessExitCleanup(cwd: string, name: string) {
  let disposed = false

  const cleanup = () => {
    if (disposed) {
      return
    }

    disposed = true
    process.off('exit', cleanup)
    const result = runPortlessSync(cwd, ['alias', '--remove', name])
    if (result.error || result.status) {
      const message = result.stderr?.trim() || result.error?.message || `portless exited with code ${result.status}`
      process.stderr.write(`Failed to remove the portless alias for ${name}: ${message}\n`)
    }
  }

  process.on('exit', cleanup)

  return () => {
    disposed = true
    process.off('exit', cleanup)
  }
}

function createPortlessError(action: string, error: unknown) {
  const message = typeof error === 'object' && error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()
    ? error.stderr.trim()
    : error instanceof Error && error.message
      ? error.message
      : 'Unknown portless error'

  return new Error(`Failed to ${action}: ${message}`)
}

export async function resolvePortlessName(cwd: string) {
  const configuredName = await readNameFromFile(cwd, 'portless.json')
    || await readNameFromFile(cwd, 'package.json')
    || basename(cwd)
  return normalizePortlessName(configuredName)
}

function normalizePortlessName(value: string) {
  const normalizedValue = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalizedValue || DEFAULT_PORTLESS_NAME
}

function readNameFromFile(cwd: string, filename: string) {
  return readFile(join(cwd, filename), 'utf8')
    .then(contents => JSON.parse(contents))
    .then(config => typeof config.name === 'string' ? config.name : undefined)
    .catch(() => undefined)
}

function runPortless(cwd: string, args: string[]) {
  return x('portless', args, {
    throwOnError: true,
    nodeOptions: {
      cwd,
      stdio: 'pipe',
    },
  })
}

function runPortlessSync(cwd: string, args: string[]) {
  return spawnSync('portless', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })
}
