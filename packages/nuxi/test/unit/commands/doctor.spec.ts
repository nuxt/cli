import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadNuxt = vi.fn()
const mockCallHook = vi.fn()
const mockClose = vi.fn()

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({
    loadNuxt: mockLoadNuxt,
  }),
  tryResolveNuxt: () => '/fake-nuxt-path',
}))

vi.mock('pkg-types', () => ({
  readPackageJSON: (pkg: string) => {
    if (pkg === 'nuxt') {
      return Promise.resolve({ version: '3.15.0' })
    }
    return Promise.reject(new Error('not found'))
  },
}))

// Mock @clack/prompts to spy on log.message
const mockLogMessage = vi.fn()
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { message: mockLogMessage, warn: vi.fn(), error: vi.fn() },
}))

// Mock process.exit to prevent tests from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

// Store original process versions to restore after tests
const originalProcessVersion = process.version
const originalProcessVersionsNode = process.versions.node

describe('nuxt doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    // Reset mockCallHook implementation (clearAllMocks only clears history, not implementation)
    mockCallHook.mockReset()

    // Restore process versions in case previous test modified them
    Object.defineProperty(process, 'version', { value: originalProcessVersion, configurable: true })
    Object.defineProperty(process.versions, 'node', { value: originalProcessVersionsNode, configurable: true })

    // Default mock for loadNuxt
    mockLoadNuxt.mockResolvedValue({
      options: {
        ssr: true,
        nitro: {},
        _installedModules: [],
        compatibilityDate: '2025-01-01',
      },
      callHook: mockCallHook,
      close: mockClose,
    })
  })

  it('should run core checks successfully', async () => {
    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    expect(mockLoadNuxt).toHaveBeenCalled()
    expect(mockCallHook).toHaveBeenCalledWith('doctor:check', expect.objectContaining({
      addCheck: expect.any(Function),
      nuxt: expect.any(Object),
    }))
    expect(mockClose).toHaveBeenCalled()
  })

  it('should exit with code 1 when errors are found', async () => {
    // Module adds an error check via hook
    mockCallHook.mockImplementation(async (hookName, ctx) => {
      if (hookName === 'doctor:check') {
        ctx.addCheck({
          name: 'Test',
          status: 'error',
          message: 'Something is broken',
          source: 'test-module',
        })
      }
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it.each([
    { name: 'warning via hook', options: {}, hook: (ctx: any) => ctx.addCheck({ name: 'Test', status: 'warning', message: 'msg' }) },
    { name: 'deprecated target option', options: { target: 'static' }, hook: null },
    { name: 'deprecated mode option', options: { mode: 'spa' }, hook: null },
    { name: 'module incompatibility', options: { _installedModules: [{ meta: { name: '@old/module', compatibility: { nuxt: '^2.0.0' } } }] }, hook: null },
  ])('should not exit for warning: $name', async ({ options, hook }) => {
    mockLoadNuxt.mockResolvedValueOnce({
      options: { ssr: true, nitro: {}, _installedModules: [], compatibilityDate: '2025-01-01', ...options },
      callHook: hook
        ? async (hookName: string, ctx: any) => {
          if (hookName === 'doctor:check')
            hook(ctx)
        }
        : mockCallHook,
      close: mockClose,
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    expect(mockExit).not.toHaveBeenCalled()
  })

  it('should handle hook errors gracefully and still close nuxt', async () => {
    mockCallHook.mockRejectedValueOnce(new Error('Hook failed'))

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    // Hook error is caught and converted to error check, so exit(1) is called
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockClose).toHaveBeenCalled()
  })

  it('should handle loadNuxt failure gracefully', async () => {
    mockLoadNuxt.mockRejectedValueOnce(new Error('Failed to load nuxt.config'))

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('should error on Node.js < 18', async () => {
    // Mock Node version < 18
    Object.defineProperty(process, 'version', { value: 'v16.20.0', configurable: true })
    Object.defineProperty(process.versions, 'node', { value: '16.20.0', configurable: true })

    mockLoadNuxt.mockResolvedValueOnce({
      options: {
        ssr: true,
        nitro: {},
        _installedModules: [],
        compatibilityDate: '2025-01-01',
      },
      callHook: mockCallHook,
      close: mockClose,
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    // Node < 18 is an error
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('should warn when prerender routes defined with SSR disabled', async () => {
    mockLoadNuxt.mockResolvedValueOnce({
      options: {
        ssr: false,
        nitro: { prerender: { routes: ['/'] } },
        _installedModules: [],
        compatibilityDate: '2025-01-01',
      },
      callHook: mockCallHook,
      close: mockClose,
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    // Check that warning about prerender was shown
    const output = mockLogMessage.mock.calls.flat().join('\n')
    expect(output).toContain('prerender routes defined but SSR is disabled')
    expect(mockExit).not.toHaveBeenCalled()
  })

  it('should warn when compatibilityDate is missing', async () => {
    mockLoadNuxt.mockResolvedValueOnce({
      options: {
        ssr: true,
        nitro: {},
        _installedModules: [],
        // no compatibilityDate
      },
      callHook: mockCallHook,
      close: mockClose,
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    // Check that warning about compatibilityDate was shown
    const output = mockLogMessage.mock.calls.flat().join('\n')
    expect(output).toContain('missing "compatibilityDate"')
    expect(mockExit).not.toHaveBeenCalled()
  })

  it('should output clean JSON when --json flag is set (no clack prompts)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mockCallHook.mockImplementation(async (hookName, ctx) => {
      if (hookName === 'doctor:check') {
        ctx.addCheck({
          name: 'Test',
          status: 'warning',
          message: 'Test warning',
          suggestion: 'Fix it',
          url: 'https://example.com',
        })
      }
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', json: true, _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    // Should only call console.log once with valid JSON
    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(consoleSpy.mock.calls[0]).toBeDefined()
    const rawOutput = consoleSpy.mock.calls[0]![0]

    // Verify output is valid JSON (no intro/outro pollution)
    expect(() => JSON.parse(rawOutput)).not.toThrow()
    const output = JSON.parse(rawOutput)
    expect(Array.isArray(output)).toBe(true)
    expect(output.some((c: any) => c.name === 'Test' && c.suggestion === 'Fix it')).toBe(true)

    consoleSpy.mockRestore()
  })

  it('should output valid JSON on loadNuxt failure with --json flag', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockLoadNuxt.mockRejectedValueOnce(new Error('Config parse error'))

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', json: true, _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(consoleSpy.mock.calls[0]).toBeDefined()
    const rawOutput = consoleSpy.mock.calls[0]![0]
    expect(() => JSON.parse(rawOutput)).not.toThrow()
    const output = JSON.parse(rawOutput)
    expect(output[0].status).toBe('error')
    expect(output[0].message).toContain('Failed to load Nuxt')

    consoleSpy.mockRestore()
  })

  it('should validate JSON output schema has required fields', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mockCallHook.mockImplementation(async (hookName, ctx) => {
      if (hookName === 'doctor:check') {
        ctx.addCheck({
          id: 'TEST_CHECK',
          name: 'Test',
          status: 'warning',
          message: 'Test warning',
          source: 'test-module',
          details: ['detail1', 'detail2'],
          suggestion: 'Fix it',
          url: 'https://example.com',
          data: { key: 'value' },
        })
      }
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', json: true, _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    expect(consoleSpy.mock.calls[0]).toBeDefined()
    const output = JSON.parse(consoleSpy.mock.calls[0]![0])
    const testCheck = output.find((c: any) => c.name === 'Test')
    expect(testCheck).toBeDefined()

    // Validate required fields
    expect(testCheck).toHaveProperty('name')
    expect(testCheck).toHaveProperty('status')
    expect(testCheck).toHaveProperty('message')
    expect(['success', 'warning', 'error']).toContain(testCheck.status)

    // Validate optional fields are preserved
    expect(testCheck.id).toBe('TEST_CHECK')
    expect(testCheck.source).toBe('test-module')
    expect(testCheck.details).toEqual(['detail1', 'detail2'])
    expect(testCheck.suggestion).toBe('Fix it')
    expect(testCheck.url).toBe('https://example.com')
    expect(testCheck.data).toEqual({ key: 'value' })

    consoleSpy.mockRestore()
  })

  it('should show verbose fields when --verbose flag is set', async () => {
    mockLoadNuxt.mockResolvedValueOnce({
      options: {
        ssr: true,
        nitro: {},
        _installedModules: [],
        compatibilityDate: '2025-01-01',
      },
      callHook: mockCallHook,
      close: mockClose,
    })

    mockCallHook.mockImplementation(async (hookName, ctx) => {
      if (hookName === 'doctor:check') {
        ctx.addCheck({
          name: 'Test',
          status: 'warning',
          message: 'Test warning',
          suggestion: 'Fix it',
          url: 'https://example.com',
        })
      }
    })

    const { default: command } = await import('../../../src/commands/doctor')

    await command.run!({
      args: { cwd: '/fake-dir', rootDir: '/fake-dir', verbose: true, _: [] } as any,
      rawArgs: [],
      cmd: command,
      data: undefined,
    })

    // Verbose mode shows suggestion and url
    const output = mockLogMessage.mock.calls.flat().join('\n')
    expect(output).toContain('💡')
    expect(output).toContain('Fix it')
    expect(output).toContain('🔗')
    expect(output).toContain('https://example.com')
    expect(mockClose).toHaveBeenCalled()
  })
})
