import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileChangeTracker } from '../../src/dev/utils'

describe('fileWatcher', () => {
  let tempDir: string
  let tempSubdir: string
  let testFile: string
  let testSubdirFile: string
  let fileWatcher: FileChangeTracker

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'nuxt-cli-test-'))
    tempSubdir = join(tempDir, 'subdir')
    await mkdir(tempSubdir)
    testFile = join(tempDir, 'test-config.js')
    testSubdirFile = join(tempSubdir, 'test-subdir-config.js')
    fileWatcher = new FileChangeTracker()
  })

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('should return true for first check of a file', async () => {
    await writeFile(testFile, 'initial content')

    const shouldEmit = fileWatcher.shouldEmitChange(testFile)
    expect(shouldEmit).toBe(true)
  })

  it('should return false for first check of a file if primed', async () => {
    await writeFile(testFile, 'initial content')

    fileWatcher.prime(testFile)
    const shouldEmit = fileWatcher.shouldEmitChange(testFile)
    expect(shouldEmit).toBe(false)
  })

  it('should return false for first check of nested files if primed in recursive mode', async () => {
    await writeFile(testFile, 'initial content')
    await writeFile(testSubdirFile, 'initial content in subdir')

    // Prime the directory in recursive mode
    fileWatcher.prime(tempDir, true)
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)
    expect(fileWatcher.shouldEmitChange(testSubdirFile)).toBe(false)
    expect(fileWatcher.shouldEmitChange(tempDir)).toBe(false)
    expect(fileWatcher.shouldEmitChange(tempSubdir)).toBe(false)
  })

  it('should return true for first check of nested files if primed in non-recursive mode', async () => {
    await writeFile(testFile, 'initial content')
    await writeFile(testSubdirFile, 'initial content in subdir')

    // Prime the directory in recursive mode
    fileWatcher.prime(tempDir)
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)
    expect(fileWatcher.shouldEmitChange(testSubdirFile)).toBe(true)
    expect(fileWatcher.shouldEmitChange(tempDir)).toBe(false)
    expect(fileWatcher.shouldEmitChange(tempSubdir)).toBe(false)
  })

  it('should return false for first check of a file if directory is primed', async () => {
    await writeFile(testFile, 'initial content')

    fileWatcher.prime(tempDir)
    const shouldEmit = fileWatcher.shouldEmitChange(testFile)
    expect(shouldEmit).toBe(false)
    // Also test the directory itself
    const dirShouldEmit = fileWatcher.shouldEmitChange(tempDir)
    expect(dirShouldEmit).toBe(false)
  })

  it('should return false when file has not been modified', async () => {
    await writeFile(testFile, 'initial content')

    // First call should return true (new file)
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)

    // Second call without modification should return false
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)

    // Third call still should return false
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)
  })

  it('should return true when file has been modified', async () => {
    await writeFile(testFile, 'initial content')

    // First check
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)

    // No modification - should return false
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)

    // Wait a bit and modify the file
    await new Promise(resolve => setTimeout(resolve, 10))
    await writeFile(testFile, 'modified content')

    // Should return true because file was modified
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)

    // Subsequent check without modification should return false
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)
  })

  it('should return true only when file has been modified, if primed', async () => {
    await writeFile(testFile, 'initial content')
    fileWatcher.prime(testFile)

    // First check
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)

    // No modification - should return false
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)

    // Wait a bit and modify the file
    await new Promise(resolve => setTimeout(resolve, 10))
    await writeFile(testFile, 'modified content')

    // Should return true because file was modified
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)

    // Subsequent check without modification should return false
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)
  })

  it('should handle file deletion gracefully', async () => {
    await writeFile(testFile, 'content')

    // First check
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)

    // Delete the file
    await rm(testFile)

    // Should return true when file is deleted (indicates change)
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)
  })

  it('should detect mtime changes even with same content', async () => {
    await writeFile(testFile, 'same content')

    // First check
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)

    // No change
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(false)

    // Manually update mtime to simulate file modification
    const now = Date.now()
    await utimes(testFile, new Date(now), new Date(now + 1000))

    // Should detect the mtime change
    expect(fileWatcher.shouldEmitChange(testFile)).toBe(true)
  })
})
