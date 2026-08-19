import { afterEach, describe, expect, it, vi } from 'vitest'

const { initialize } = vi.hoisted(() => ({
  initialize: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../../src/dev', () => ({ initialize }))

describe('nuxt _dev command', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    initialize.mockClear()
  })

  it('should initialize the requested root directory', async () => {
    const { runCommand } = await import('../../../src/run')

    await runCommand('_dev', ['fixtures/app'])

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: expect.stringMatching(/fixtures[/\\]app$/) }),
      expect.any(Object),
    )
  })

  it('should use the test port as a loopback-only listen override', async () => {
    vi.stubEnv('_PORT', '4321')
    const { runCommand } = await import('../../../src/run')

    await runCommand('_dev', [])

    expect(initialize).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        listenOverrides: {
          port: '4321',
          hostname: '127.0.0.1',
          showURL: false,
          strictPort: true,
        },
      }),
    )
  })

  it('should still allow a random port with `_PORT=0`', async () => {
    vi.stubEnv('_PORT', '0')
    const { runCommand } = await import('../../../src/run')

    await runCommand('_dev', [])

    expect(initialize).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        listenOverrides: expect.objectContaining({ port: '0', strictPort: true }),
      }),
    )
  })
})
