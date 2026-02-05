import type { NuxtModule } from '../../../../src/commands/module/_utils'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock std-env before importing the module
const mockHasTTY = vi.hoisted(() => ({ value: true }))

vi.mock('std-env', () => ({
  hasTTY: mockHasTTY.value,
}))

// Mock @clack/prompts
const mockAutocompleteMultiselect = vi.hoisted(() => vi.fn())
const mockIsCancel = vi.hoisted(() => vi.fn(() => false))

vi.mock('@clack/prompts', () => ({
  autocompleteMultiselect: mockAutocompleteMultiselect,
  isCancel: mockIsCancel,
}))

// Mock logger
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../../../src/utils/logger', () => ({
  logger: mockLogger,
}))

// Helper to create mock modules
function createMockModule(overrides: Partial<NuxtModule> = {}): NuxtModule {
  return {
    name: 'test-module',
    npm: '@nuxt/test-module',
    compatibility: {
      nuxt: '^3.0.0',
      requires: {},
      versionMap: {},
    },
    description: 'A test module',
    repo: '',
    github: '',
    website: '',
    learn_more: '',
    category: 'UI',
    type: 'community',
    maintainers: [],
    stats: {
      downloads: 0,
      stars: 0,
      maintainers: 0,
      contributors: 0,
      modules: 0,
    },
    ...overrides,
  }
}

describe('selectModulesAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasTTY.value = true
    mockIsCancel.mockReturnValue(false)

    // Reset process.stdout.isTTY for each test
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    })

    // Reset process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', {
      value: 120,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('tTY handling', () => {
    it('should return empty result when not in TTY environment', async () => {
      // Re-mock std-env with hasTTY = false
      vi.doMock('std-env', () => ({
        hasTTY: false,
      }))

      // Re-import the module to get the new mock
      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule()]
      const result = await selectModulesAutocomplete({ modules })

      expect(result).toEqual({ selected: [], cancelled: false })
      expect(mockLogger.warn).toHaveBeenCalledWith('Interactive module selection requires a TTY. Skipping.')
    })

    it('should proceed with prompts when in TTY environment', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      // Mock autocompleteMultiselect to return empty array
      mockAutocompleteMultiselect.mockResolvedValueOnce([])

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule()]
      const result = await selectModulesAutocomplete({ modules })

      expect(result).toEqual({ selected: [], cancelled: false })
      expect(mockAutocompleteMultiselect).toHaveBeenCalled()
    })
  })

  describe('module sorting', () => {
    it('should sort official modules before community modules', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedOptions: any[] = []

      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedOptions = opts.options
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [
        createMockModule({ npm: '@community/z-module', type: 'community', name: 'z-module' }),
        createMockModule({ npm: '@nuxt/a-module', type: 'official', name: 'a-module' }),
        createMockModule({ npm: '@community/b-module', type: 'community', name: 'b-module' }),
        createMockModule({ npm: '@nuxt/c-module', type: 'official', name: 'c-module' }),
      ]

      await selectModulesAutocomplete({ modules })

      // Official modules should come first, then sorted alphabetically
      const npmNames = capturedOptions.map((c: any) => c.value)
      expect(npmNames[0]).toBe('@nuxt/a-module')
      expect(npmNames[1]).toBe('@nuxt/c-module')
      expect(npmNames[2]).toBe('@community/b-module')
      expect(npmNames[3]).toBe('@community/z-module')
    })
  })

  describe('module selection', () => {
    it('should return selected modules when user selects and confirms', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      // Simulate: user selects modules and confirms
      mockAutocompleteMultiselect.mockResolvedValueOnce(['@nuxt/ui'])

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [
        createMockModule({ npm: '@nuxt/ui', name: 'ui' }),
        createMockModule({ npm: '@nuxt/icon', name: 'icon' }),
      ]

      const result = await selectModulesAutocomplete({ modules })

      expect(result.selected).toContain('@nuxt/ui')
      expect(result.selected).toHaveLength(1)
      expect(result.cancelled).toBe(false)
    })

    it('should allow selecting multiple modules', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      mockAutocompleteMultiselect.mockResolvedValueOnce(['@nuxt/ui', '@nuxt/icon', '@nuxt/image'])

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [
        createMockModule({ npm: '@nuxt/ui', name: 'ui' }),
        createMockModule({ npm: '@nuxt/icon', name: 'icon' }),
        createMockModule({ npm: '@nuxt/image', name: 'image' }),
      ]

      const result = await selectModulesAutocomplete({ modules })

      expect(result.selected).toHaveLength(3)
      expect(result.selected).toContain('@nuxt/ui')
      expect(result.selected).toContain('@nuxt/icon')
      expect(result.selected).toContain('@nuxt/image')
    })
  })

  describe('cancellation handling', () => {
    it('should return cancelled true when user cancels', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      const cancelSymbol = Symbol('cancel')
      mockAutocompleteMultiselect.mockResolvedValueOnce(cancelSymbol)
      mockIsCancel.mockReturnValueOnce(true)

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule()]
      const result = await selectModulesAutocomplete({ modules })

      expect(result).toEqual({ selected: [], cancelled: true })
    })
  })

  describe('custom message', () => {
    it('should use custom message when provided', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedMessage = ''
      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedMessage = opts.message
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const customMessage = 'Custom search message:'
      await selectModulesAutocomplete({
        modules: [createMockModule()],
        message: customMessage,
      })

      expect(capturedMessage).toBe(customMessage)
    })

    it('should use default message when not provided', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedMessage = ''
      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedMessage = opts.message
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [createMockModule()],
      })

      expect(capturedMessage).toBe('Search and select modules:')
    })
  })

  describe('filter function', () => {
    it('should pass filter function to autocompleteMultiselect', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedFilter: ((search: string, option: any) => boolean) | undefined
      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedFilter = opts.filter
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [
          createMockModule({ npm: '@nuxt/tailwind', name: 'tailwind' }),
          createMockModule({ npm: '@nuxt/ui', name: 'ui' }),
        ],
      })

      expect(capturedFilter).toBeDefined()
      expect(typeof capturedFilter).toBe('function')
    })

    it('should return true for all options when search is empty', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedFilter: ((search: string, option: any) => boolean) | undefined

      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedFilter = opts.filter
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [
          createMockModule({ npm: '@nuxt/a', name: 'a' }),
          createMockModule({ npm: '@nuxt/b', name: 'b' }),
        ],
      })

      // Test the filter function with empty input
      const result = capturedFilter!('', { value: '@nuxt/a', label: '@nuxt/a' })
      expect(result).toBe(true)
    })

    it('should filter options based on fuzzy search', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedFilter: ((search: string, option: any) => boolean) | undefined

      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedFilter = opts.filter
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [
          createMockModule({ npm: '@nuxt/tailwind', name: 'tailwind', category: 'UI' }),
          createMockModule({ npm: '@nuxt/image', name: 'image', category: 'Media' }),
        ],
      })

      // Test fuzzy search matches
      expect(capturedFilter!('tail', { value: '@nuxt/tailwind', label: '@nuxt/tailwind' })).toBe(true)
      expect(capturedFilter!('tail', { value: '@nuxt/image', label: '@nuxt/image' })).toBe(false)
    })
  })

  describe('options structure', () => {
    it('should create options with correct structure', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedOptions: any[] = []
      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedOptions = opts.options
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [createMockModule({ npm: '@nuxt/test', description: 'A test module.' })],
      })

      expect(capturedOptions[0]).toEqual({
        value: '@nuxt/test',
        label: '@nuxt/test',
        hint: 'A test module', // trailing period removed
      })
    })

    it('should set required to false', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedRequired: boolean | undefined
      mockAutocompleteMultiselect.mockImplementation(async (opts: any) => {
        capturedRequired = opts.required
        return []
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [createMockModule()],
      })

      expect(capturedRequired).toBe(false)
    })
  })
})
