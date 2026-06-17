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

describe('non-interactive mode (no TTY)', () => {
  it('shows help and exits with code 2 when required arguments are missing', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const result = await x(createNuxt, ['--preferOffline'], {
      throwOnError: false,
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
    })

    const output = result.stdout + result.stderr

    expect(result.exitCode).toBe(2)
    // citty help output
    expect(output).toContain('USAGE')
    // which arguments are required
    expect(output).toContain('Missing required arguments')
    expect(output).toContain('--template')
    expect(output).toContain('--packageManager')
    expect(output).toContain('--gitInit')
    // list of available templates since one must be picked
    expect(output).toContain('minimal')
  })

  it('creates a project without prompting when all required arguments are provided', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const installPath = join(tmpdir(), 'create-nuxt-non-interactive-test')

    await rm(installPath, { recursive: true, force: true })
    try {
      await x(createNuxt, [installPath, '--template=minimal', '--packageManager=pnpm', '--gitInit=false', '--preferOffline', '--install=false'], {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      expect(existsSync(join(installPath, 'package.json'))).toBeTruthy()
    }
    finally {
      await rm(installPath, { recursive: true, force: true })
    }
  })

  it('fails fast when the target directory already exists', { timeout: isWindows ? 200000 : 50000 }, async () => {
    const installPath = join(tmpdir(), 'create-nuxt-existing-dir-test')

    await rm(installPath, { recursive: true, force: true })
    try {
      const args = [installPath, '--template=minimal', '--packageManager=pnpm', '--gitInit=false', '--preferOffline', '--install=false']
      await x(createNuxt, args, {
        throwOnError: true,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      const result = await x(createNuxt, args, {
        throwOnError: false,
        nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('--force')
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
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--gitInit=false', '--preferOffline', '--install=false'], {
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
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--gitInit=false', '--preferOffline', '--install=false'], {
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
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--gitInit=false', '--preferOffline', '--install=false'], {
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
      await x(createNuxt, [installPath, '--packageManager=pnpm', '--template=minimal', '--gitInit=false', '--preferOffline', '--install=false'], {
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
