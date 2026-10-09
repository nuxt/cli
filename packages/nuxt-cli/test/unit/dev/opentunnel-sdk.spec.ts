import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { basename, join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'

const confirm = vi.fn()
const isInteractive = vi.fn(() => false)
const runInstall = vi.fn()

vi.mock('@clack/prompts', async importOriginal => ({
  ...await importOriginal<typeof import('@clack/prompts')>(),
  confirm: (...args: unknown[]) => confirm(...args),
}))
vi.mock('../../../src/utils/stdout', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/stdout')>(),
  isInteractive: () => isInteractive(),
}))
vi.mock('../../../src/utils/install', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/install')>(),
  runInstall: (...args: unknown[]) => runInstall(...args),
}))
vi.mock('../../../src/utils/package-managers', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/package-managers')>(),
  detectPackageManager: async () => ({ name: 'pnpm', agent: 'pnpm' }),
}))

const { findOpenTunnelSDK, loadOpenTunnelSDK, OPENTUNNEL_SDK } = await import('../../../src/dev/tunnel/opentunnel-loader')
const { ensureOpenTunnelSDK } = await import('../../../src/dev/tunnel/opentunnel-install')

let project: string

/**
 * A package in the project's `node_modules`. Like `@opentunnel/client`, it does
 * not export its `package.json`, so it is found through its main entry. Its
 * `create` returns the URL of the module, so a test can tell which copy loaded.
 */
function installPackage(name: string, version: string): void {
  const dir = join(project, 'node_modules', name)
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: { '.': { default: './dist/index.js' } } }))
  writeFileSync(join(dir, 'dist/index.js'), 'export const create = () => import.meta.url\n')
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'nuxt-opentunnel-sdk-'))
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'app', private: true }))
  isInteractive.mockReturnValue(false)
  vi.spyOn(logger, 'info').mockImplementation(() => {})
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  confirm.mockReset()
  runInstall.mockReset()
  rmSync(project, { recursive: true, force: true })
})

describe('findOpenTunnelSDK', () => {
  it('should report a missing SDK', () => {
    expect(findOpenTunnelSDK(project)).toEqual({ status: 'missing' })
  })

  it('should find a compatible SDK through its main entry', () => {
    installPackage(OPENTUNNEL_SDK, '0.4.3')
    expect(findOpenTunnelSDK(project)).toMatchObject({ status: 'installed', version: '0.4.3' })
  })

  it('should reject a release outside the supported range', () => {
    installPackage(OPENTUNNEL_SDK, '0.3.0')
    expect(findOpenTunnelSDK(project)).toEqual({ status: 'incompatible', version: '0.3.0' })
    installPackage(OPENTUNNEL_SDK, '0.5.0')
    expect(findOpenTunnelSDK(project)).toEqual({ status: 'incompatible', version: '0.5.0' })
  })
})

describe('loadOpenTunnelSDK', () => {
  it('should import the SDK from the project', async () => {
    installPackage(OPENTUNNEL_SDK, '0.4.0')
    const sdk = await loadOpenTunnelSDK(project)
    // Compared by its end: the resolver returns the real path, and the temporary
    // directory sits behind a symlink on macOS.
    expect((sdk!.create as unknown as () => string)()).toContain(`/${basename(project)}/node_modules/${OPENTUNNEL_SDK}/dist/index.js`)
  })

  it('should warn when the project has no usable SDK', async () => {
    await expect(loadOpenTunnelSDK(project)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`needs \`${OPENTUNNEL_SDK}@^0.4.0\``))
  })
})

describe('ensureOpenTunnelSDK', () => {
  function installSucceeds() {
    runInstall.mockImplementation(async () => {
      installPackage(OPENTUNNEL_SDK, '0.4.0')
      installPackage('effect', '4.0.2')
      return { success: true, output: '', command: 'pnpm add', ignoredBuilds: [] }
    })
  }

  it('should do nothing when the SDK is already installed', async () => {
    installPackage(OPENTUNNEL_SDK, '0.4.0')
    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(runInstall).not.toHaveBeenCalled()
  })

  it('should print the install command instead of installing when nobody can answer', async () => {
    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(false)
    expect(runInstall).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('`pnpm add -D @opentunnel/client@^0.4.0 effect@^4.0.0`'))
  })

  it('should install the SDK and its peer as dev dependencies once the user agrees', async () => {
    isInteractive.mockReturnValue(true)
    confirm.mockResolvedValue(true)
    installSucceeds()

    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(true)

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      cwd: project,
      dependencies: [`${OPENTUNNEL_SDK}@^0.4.0`, 'effect@^4.0.0'],
      dev: true,
    }))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should replace an incompatible SDK with a supported release', async () => {
    isInteractive.mockReturnValue(true)
    confirm.mockResolvedValue(true)
    installPackage(OPENTUNNEL_SDK, '0.3.0')
    installSucceeds()

    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(true)
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ dependencies: [`${OPENTUNNEL_SDK}@^0.4.0`, 'effect@^4.0.0'] }))
  })

  it('should reuse an `effect` the project already has', async () => {
    isInteractive.mockReturnValue(true)
    confirm.mockResolvedValue(true)
    installPackage('effect', '4.1.0')
    installSucceeds()

    await ensureOpenTunnelSDK(project)
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ dependencies: [`${OPENTUNNEL_SDK}@^0.4.0`] }))
  })

  it('should not replace the `effect` the app uses with another major', async () => {
    isInteractive.mockReturnValue(true)
    installPackage('effect', '3.18.0')

    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(runInstall).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('your project uses 3.18.0'))
  })

  it('should start without a tunnel when the user declines', async () => {
    isInteractive.mockReturnValue(true)
    confirm.mockResolvedValue(false)

    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(false)
    expect(runInstall).not.toHaveBeenCalled()
  })

  it('should start without a tunnel when the install fails', async () => {
    isInteractive.mockReturnValue(true)
    confirm.mockResolvedValue(true)
    runInstall.mockResolvedValue({ success: false, output: 'ERR_PNPM_FETCH_404', command: 'pnpm add', ignoredBuilds: [], error: 'failed with exit code 1' })

    await expect(ensureOpenTunnelSDK(project)).resolves.toBe(false)
  })
})
