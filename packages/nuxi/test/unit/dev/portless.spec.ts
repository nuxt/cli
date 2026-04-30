import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolvePortlessAliasName, resolvePortlessName } from '../../../src/dev/portless'

const tempDirs: string[] = []

async function createTempDir(name: string) {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`))
  tempDirs.push(dir)
  return dir
}

async function loadPortlessWithTinyexecMock(implementation: (command: string, args: string[]) => Promise<unknown>) {
  vi.doMock('tinyexec', () => ({
    x: vi.fn((command: string, args: string[]) => implementation(command, args)),
  }))

  return await import('../../../src/dev/portless')
}

describe('resolvePortlessName', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('preserves package scope in normalized form', async () => {
    const cwd = await createTempDir('portless-scoped')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: '@acme/web' }))

    await expect(resolvePortlessName(cwd)).resolves.toBe('acme-web')
  })

  it('prefers portless.json over package.json', async () => {
    const cwd = await createTempDir('portless-config')
    await writeFile(join(cwd, 'portless.json'), JSON.stringify({ name: 'preview-app' }))
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: '@acme/web' }))

    await expect(resolvePortlessName(cwd)).resolves.toBe('preview-app')
  })

  it('normalizes invalid characters', async () => {
    const cwd = await createTempDir('portless-normalized')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'My App/API' }))

    await expect(resolvePortlessName(cwd)).resolves.toBe('my-app-api')
  })

  it('falls back to the directory name when package name is missing', async () => {
    const root = await createTempDir('portless-missing-name')
    const cwd = join(root, 'Fancy Project')
    await mkdir(cwd)
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true }))

    await expect(resolvePortlessName(cwd)).resolves.toBe('fancy-project')
  })

  it('does not inherit a package name from parent directories', async () => {
    const root = await createTempDir('portless-parent-name')
    const cwd = join(root, 'apps', 'Web App')
    await mkdir(cwd, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'monorepo-root' }))

    await expect(resolvePortlessName(cwd)).resolves.toBe('web-app')
  })

  it('falls back to nuxt-app when normalization produces an empty name', async () => {
    const cwd = await createTempDir('portless-empty')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: '@@@' }))

    await expect(resolvePortlessName(cwd)).resolves.toBe('nuxt-app')
  })
})

describe('resolvePortlessAliasName', () => {
  it('drops the tld but preserves prefixed subdomains', () => {
    expect(resolvePortlessAliasName('https://preview.fixtures-dev.localhost')).toBe('preview.fixtures-dev')
    expect(resolvePortlessAliasName('https://fixtures-dev.test')).toBe('fixtures-dev')
  })
})

describe('portless command failures', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('tinyexec')
  })

  it('reports a missing portless binary with an install hint', async () => {
    const { ensurePortlessAvailable } = await loadPortlessWithTinyexecMock(async () => {
      const error = new Error('spawn portless ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })

    await expect(ensurePortlessAvailable('/tmp/fixtures-dev')).rejects.toThrow(
      'Portless is required for `--portless`. Install it from https://portless.sh',
    )
  })

  it('wraps stderr from portless get failures', async () => {
    const { resolvePortlessURL } = await loadPortlessWithTinyexecMock(async (_command, args) => {
      if (args[0] === 'proxy') {
        return { stdout: '' }
      }

      const error = new Error('permission denied')
      ;(error as Error & { stderr?: string }).stderr = 'permission denied\n'
      throw error
    })

    await expect(resolvePortlessURL('/tmp/fixtures-dev', 'fixtures-dev')).rejects.toThrow(
      'Failed to resolve the portless URL: permission denied',
    )
  })

  it('rejects empty portless URLs', async () => {
    const { resolvePortlessURL } = await loadPortlessWithTinyexecMock(async () => ({ stdout: '   ' }))

    await expect(resolvePortlessURL('/tmp/fixtures-dev', 'fixtures-dev')).rejects.toThrow(
      'Failed to resolve the portless URL: Portless returned an empty URL',
    )
  })

  it('uses worktree-aware portless URL resolution', async () => {
    const calls: string[][] = []
    const { resolvePortlessURL } = await loadPortlessWithTinyexecMock(async (_command, args) => {
      calls.push(args)
      if (args[0] === 'proxy') {
        return { stdout: '' }
      }

      return { stdout: 'https://preview.fixtures-dev.localhost\n' }
    })

    await expect(resolvePortlessURL('/tmp/fixtures-dev', 'fixtures-dev')).resolves.toBe('https://preview.fixtures-dev.localhost')
    expect(calls).toEqual([
      ['proxy', 'start'],
      ['get', 'fixtures-dev'],
    ])
  })

  it('wraps portless alias failures with the action name', async () => {
    const { registerPortlessAlias, removePortlessAlias } = await loadPortlessWithTinyexecMock(async () => {
      throw new Error('alias command failed')
    })

    await expect(registerPortlessAlias('/tmp/fixtures-dev', 'fixtures-dev', 3000)).rejects.toThrow(
      'Failed to register the portless alias for port 3000: alias command failed',
    )
    await expect(removePortlessAlias('/tmp/fixtures-dev', 'fixtures-dev')).rejects.toThrow(
      'Failed to remove the portless alias for fixtures-dev: alias command failed',
    )
  })

  it('registers portless aliases with force', async () => {
    const calls: string[][] = []
    const { registerPortlessAlias } = await loadPortlessWithTinyexecMock(async (_command, args) => {
      calls.push(args)
      return { stdout: '' }
    })

    await registerPortlessAlias('/tmp/fixtures-dev', 'fixtures-dev', 3000)

    expect(calls).toEqual([['alias', 'fixtures-dev', '3000', '--force']])
  })
})
