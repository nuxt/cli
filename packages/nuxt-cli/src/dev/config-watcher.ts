import type { Stats } from 'node:fs'

import { Buffer } from 'node:buffer'
import { hash } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, watch } from 'node:fs'

import { join, resolve } from 'pathe'

// https://regex101.com/r/7HkR5c/1
const RESTART_RE = /^(?:nuxt\.config\.[a-z0-9]+|\.nuxtignore|\.nuxtrc|\.config\/nuxt(?:\.config)?\.[a-z0-9]+)$/

/**
 * Files above this size are tracked by mtime alone.
 */
const MAX_HASHED_FILE_SIZE = 256 * 1024

interface TrackedFile {
  mtimeMs: number
  /** Absent for directories and for files too large to hash. */
  contentHash?: string
}

function hashFileContents(path: string, size: number): string | undefined {
  if (size > MAX_HASHED_FILE_SIZE) {
    return undefined
  }
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    // The stat'd size can be stale, so cap the read rather than trusting it; an
    // extra byte means the file outgrew the limit and falls back to mtime.
    const buffer = Buffer.allocUnsafe(MAX_HASHED_FILE_SIZE + 1)
    let read = 0
    while (read < buffer.length) {
      const bytes = readSync(fd, buffer, read, buffer.length - read, read)
      if (bytes === 0) {
        break
      }
      read += bytes
    }
    if (read > MAX_HASHED_FILE_SIZE) {
      return undefined
    }
    return hash('sha1', buffer.subarray(0, read), 'hex')
  }
  catch {
    return undefined
  }
  finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      }
      catch {}
    }
  }
}

function trackFile(path: string, stats: Stats): TrackedFile {
  if (stats.isDirectory()) {
    return { mtimeMs: stats.mtimeMs }
  }
  return { mtimeMs: stats.mtimeMs, contentHash: hashFileContents(path, stats.size) }
}

export class FileChangeTracker {
  private entries = new Map<string, TrackedFile>()

  /**
   * Whether a watcher event for `filePath` represents a real change.
   *
   * Regular files are compared by content, so identical rewrites (atomic saves,
   * formatters, `git checkout` of the same revision) do not trigger a reload.
   * Directories and files over `MAX_HASHED_FILE_SIZE` fall back to mtime.
   */
  shouldEmitChange(filePath: string): boolean {
    const resolved = resolve(filePath)
    try {
      const stats = statSync(resolved)
      const previous = this.entries.get(resolved)
      const current = trackFile(resolved, stats)

      this.entries.set(resolved, current)

      if (previous === undefined) {
        return true
      }
      if (previous.contentHash !== undefined && current.contentHash !== undefined) {
        return previous.contentHash !== current.contentHash
      }
      return previous.mtimeMs !== current.mtimeMs
    }
    catch {
      // remove from cache if it has been deleted or is inaccessible
      this.entries.delete(resolved)
      return true
    }
  }

  prime(filePath: string, recursive: boolean = false): void {
    const resolved = resolve(filePath)
    const stat = statSync(resolved)
    this.entries.set(resolved, trackFile(resolved, stat))
    if (stat.isDirectory()) {
      const entries = readdirSync(resolved)
      for (const entry of entries) {
        const fullPath = resolve(resolved, entry)
        try {
          const stats = statSync(fullPath)
          this.entries.set(fullPath, trackFile(fullPath, stats))
          if (recursive && stats.isDirectory()) {
            this.prime(fullPath, recursive)
          }
        }
        catch {
          // ignore
        }
      }
    }
  }
}

// Skips the root (already watched) and external layers (`node_modules` or out of tree) whose config
// isn't expected to change during local dev.
export function getLocalLayerDirs(layers: ReadonlyArray<{ cwd?: string, config?: { rootDir?: string } | null }>, cwd: string): string[] {
  const root = resolve(cwd)
  const dirs = new Set<string>()
  for (const layer of layers) {
    const dir = layer.cwd || layer.config?.rootDir
    const resolved = dir && resolve(dir)
    if (resolved && resolved !== root && resolved.startsWith(`${root}/`) && !resolved.includes('/node_modules/')) {
      dirs.add(resolved)
    }
  }
  return [...dirs]
}

export function createConfigWatcher(cwd: string, dotenvFileName: string | string[] = '.env', onRestart: (file: string) => void, onReload: (file: string) => void, layerDirs: string[] = []) {
  const dotenvFileNames = new Set(Array.isArray(dotenvFileName) ? dotenvFileName : [dotenvFileName])

  // each local layer dir is watched alongside the root, but only the root restarts on dotenv changes.
  const closers = [
    watchConfigDir(cwd, onReload, (file, path) => dotenvFileNames.has(file) && onRestart(path)),
    ...layerDirs.map(dir => watchConfigDir(dir, onReload)),
  ]

  return () => {
    for (const close of closers) {
      close()
    }
  }
}

/**
 * Collapse the burst of watcher events a single save produces into one call per
 * file. A truncate-then-write save is briefly observable as an empty file, and
 * evaluating it mid-write would report a spurious change.
 */
export function perFile(handler: (file: string) => void, delay = 30): { listener: (event: unknown, file: string | null) => void, cancel: () => void } {
  const timers = new Map<string, NodeJS.Timeout>()
  return {
    listener: (_event, file) => {
      if (!file) {
        return
      }
      clearTimeout(timers.get(file))
      const timer = setTimeout(() => {
        timers.delete(file)
        handler(file)
      }, delay)
      timer.unref?.()
      timers.set(file, timer)
    },
    cancel: () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    },
  }
}

function watchConfigDir(dir: string, onReload: (path: string) => void, onFile?: (file: string, path: string) => void) {
  const fileWatcher = new FileChangeTracker()
  fileWatcher.prime(dir)
  const watcher = watch(dir)
  let configDirWatcher = existsSync(join(dir, '.config')) ? createConfigDirWatcher(dir, onReload) : undefined

  const { listener, cancel } = perFile((file) => {
    if (!fileWatcher.shouldEmitChange(resolve(dir, file))) {
      return
    }

    onFile?.(file, resolve(dir, file))

    if (RESTART_RE.test(file)) {
      onReload(resolve(dir, file))
    }

    if (file === '.config') {
      configDirWatcher ||= createConfigDirWatcher(dir, onReload)
    }
  })
  watcher.on('change', listener)

  return () => {
    cancel()
    watcher.close()
    configDirWatcher?.()
  }
}

function createConfigDirWatcher(cwd: string, onReload: (path: string) => void) {
  const configDir = join(cwd, '.config')
  const fileWatcher = new FileChangeTracker()

  fileWatcher.prime(configDir)
  const configDirWatcher = watch(configDir)
  const { listener, cancel } = perFile((file) => {
    if (!fileWatcher.shouldEmitChange(resolve(configDir, file))) {
      return
    }

    if (RESTART_RE.test(file)) {
      onReload(resolve(configDir, file))
    }
  })
  configDirWatcher.on('change', listener)

  return () => {
    cancel()
    configDirWatcher.close()
  }
}
