import { existsSync } from 'node:fs'

import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWindows } from 'std-env'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../../playground', import.meta.url))
const createNuxt = fileURLToPath(new URL('../bin/create-nuxt.mjs', import.meta.url))

describe('non-interactive mode', () => {
  it('should exit with code 2 when no dir is provided and no TTY', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const result = await x(createNuxt, ['--yes', '--preferOffline'], {
      throwOnError: false,
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toContain('Non-interactive mode')
    expect(result.stdout).toContain('create-nuxt <dir>')
  })

  it('should proceed without prompts when dir is provided with --yes', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const dir = tmpdir()
    const installPath = join(dir, 'non-interactive-test')

    await rm(installPath, { recursive: true, force: true })
    try {
      await x(createNuxt, [installPath, '--yes', '--template=minimal', '--no-gitInit', '--preferOffline', '--no-install'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      expect(existsSync(join(installPath, 'package.json'))).toBeTruthy()
    }
    finally {
      await rm(installPath, { recursive: true, force: true })
    }
  })
})

describe('init command package name slugification', () => {
  it('should slugify directory names with special characters', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const dir = tmpdir()
    const specialDirName = 'my@special#project!'
    const installPath = join(dir, specialDirName)

    await rm(installPath, { recursive: true, force: true })
    try {
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--no-gitInit', '--preferOffline', '--no-install'], {
        throwOnError: true,
        nodeOptions: { stdio: 'inherit', cwd: fixtureDir },
      })

      // Check that package.json was created
      const packageJsonPath = join(installPath, 'package.json')
      expect(existsSync(packageJsonPath)).toBeTruthy()

      // Read package.json and verify the name was slugified
      const packageJsonContent = await readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(packageJsonContent)

      // The name should be slugified: my@special#project! -> my-special-project
      expect(packageJson.name).toBe('my-special-project')
    }
    finally {
      await rm(installPath, { recursive: true, force: true })
    }
  })

  it('should handle consecutive special characters', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const dir = tmpdir()
    const specialDirName = 'test___project@@@name!!!'
    const installPath = join(dir, specialDirName)

    await rm(installPath, { recursive: true, force: true })
    try {
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--no-gitInit', '--preferOffline', '--no-install'], {
        throwOnError: true,
        nodeOptions: { stdio: 'inherit', cwd: fixtureDir },
      })

      const packageJsonPath = join(installPath, 'package.json')
      expect(existsSync(packageJsonPath)).toBeTruthy()

      const packageJsonContent = await readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(packageJsonContent)

      // Note: underscores are word characters (\w) so they are preserved
      // Only @@@!!! are replaced with hyphens, then consecutive hyphens are collapsed
      expect(packageJson.name).toBe('test___project-name')
    }
    finally {
      await rm(installPath, { recursive: true, force: true })
    }
  })

  it('should handle leading and trailing special characters', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const dir = tmpdir()
    const specialDirName = '---project-name---'
    const installPath = join(dir, specialDirName)

    await rm(installPath, { recursive: true, force: true })
    try {
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--no-gitInit', '--preferOffline', '--no-install'], {
        throwOnError: true,
        nodeOptions: { stdio: 'inherit', cwd: fixtureDir },
      })

      const packageJsonPath = join(installPath, 'package.json')
      expect(existsSync(packageJsonPath)).toBeTruthy()

      const packageJsonContent = await readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(packageJsonContent)

      // Should remove leading and trailing hyphens
      expect(packageJson.name).toBe('project-name')
    }
    finally {
      await rm(installPath, { recursive: true, force: true })
    }
  })

  it('should preserve valid package names without modification', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const dir = tmpdir()
    const validDirName = 'my-valid-project-name'
    const installPath = join(dir, validDirName)

    await rm(installPath, { recursive: true, force: true })
    try {
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--no-gitInit', '--preferOffline', '--no-install'], {
        throwOnError: true,
        nodeOptions: { stdio: 'inherit', cwd: fixtureDir },
      })

      const packageJsonPath = join(installPath, 'package.json')
      expect(existsSync(packageJsonPath)).toBeTruthy()

      const packageJsonContent = await readFile(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(packageJsonContent)

      // Valid names should remain unchanged
      expect(packageJson.name).toBe('my-valid-project-name')
    }
    finally {
      await rm(installPath, { recursive: true, force: true })
    }
  })
})
