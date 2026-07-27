import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, readFileSync, release } = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  release: vi.fn(() => '6.1.0-generic'),
}))

vi.mock('node:fs', () => ({ existsSync, readFileSync }))
vi.mock('node:os', () => ({ release }))

/** Re-import so the module-level detection caches start empty. */
async function loadEnvironment() {
  vi.resetModules()
  return import('../../src/dev/environment')
}

const realPlatform = process.platform

function stubPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  existsSync.mockReturnValue(false)
  readFileSync.mockReturnValue('')
  release.mockReturnValue('6.1.0-generic')
})

afterEach(() => {
  stubPlatform(realPlatform)
  vi.clearAllMocks()
})

describe('isDocker', () => {
  it('should detect `/.dockerenv`', async () => {
    existsSync.mockReturnValue(true)
    const { isDocker } = await loadEnvironment()

    expect(isDocker()).toBe(true)
  })

  it('should detect a docker cgroup', async () => {
    readFileSync.mockReturnValue('0::/docker/abc123')
    const { isDocker } = await loadEnvironment()

    expect(isDocker()).toBe(true)
  })

  it('should cache the result', async () => {
    const { isDocker } = await loadEnvironment()

    expect(isDocker()).toBe(false)
    existsSync.mockReturnValue(true)
    expect(isDocker()).toBe(false)
  })

  it('should not detect docker on a plain host', async () => {
    const { isDocker } = await loadEnvironment()

    expect(isDocker()).toBe(false)
  })
})

describe('isWsl', () => {
  it('should detect `WSL_DISTRO_NAME`', async () => {
    const { isWsl } = await loadEnvironment()

    expect(isWsl('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe(true)
  })

  it('should detect a microsoft kernel release', async () => {
    release.mockReturnValue('5.15.0-microsoft-standard-WSL2')
    const { isWsl } = await loadEnvironment()

    expect(isWsl('linux', {})).toBe(true)
  })

  it('should detect microsoft in `/proc/version`', async () => {
    readFileSync.mockReturnValue('Linux version 5.15.0 (Microsoft@Microsoft.com)')
    const { isWsl } = await loadEnvironment()

    expect(isWsl('linux', {})).toBe(true)
  })

  it('should be false off linux', async () => {
    release.mockReturnValue('5.15.0-microsoft-standard-WSL2')
    const { isWsl } = await loadEnvironment()

    expect(isWsl('darwin', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe(false)
    expect(isWsl('win32', {})).toBe(false)
  })

  it('should be false on plain linux', async () => {
    const { isWsl } = await loadEnvironment()

    expect(isWsl('linux', {})).toBe(false)
  })
})

describe('detectIsolatedEnvironment', () => {
  it('should prefer the container over WSL', async () => {
    existsSync.mockReturnValue(true)
    release.mockReturnValue('5.15.0-microsoft-standard-WSL2')
    const { detectIsolatedEnvironment } = await loadEnvironment()

    expect(detectIsolatedEnvironment()).toBe('the container')
  })

  it('should report WSL', async () => {
    stubPlatform('linux')
    release.mockReturnValue('5.15.0-microsoft-standard-WSL2')
    const { detectIsolatedEnvironment } = await loadEnvironment()

    expect(detectIsolatedEnvironment()).toBe('WSL')
  })

  it('should report nothing on a plain host', async () => {
    const { detectIsolatedEnvironment } = await loadEnvironment()

    expect(detectIsolatedEnvironment()).toBeUndefined()
  })
})
