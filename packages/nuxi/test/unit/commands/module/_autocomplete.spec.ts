import type { NuxtModule } from '../../../../src/commands/module/_utils'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock std-env before importing the module
const mockHasTTY = vi.hoisted(() => ({ value: true }))

vi.mock('std-env', () => ({
  hasTTY: mockHasTTY.value,
}))

// Mock @posva/prompts
const mockPrompts = vi.hoisted(() => vi.fn())
vi.mock('@posva/prompts', () => ({
  default: mockPrompts,
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

      // Mock prompts to simulate user pressing Esc immediately
      mockPrompts.mockResolvedValueOnce({ module: undefined })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule()]
      const result = await selectModulesAutocomplete({ modules })

      expect(result).toEqual({ selected: [], cancelled: false })
      expect(mockPrompts).toHaveBeenCalled()
    })
  })

  describe('module sorting', () => {
    it('should sort official modules before community modules', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedChoices: any[] = []

      mockPrompts.mockImplementation(async (options: any) => {
        capturedChoices = options.choices
        return { module: undefined }
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
      const npmNames = capturedChoices.map((c: any) => c.value)
      expect(npmNames[0]).toBe('@nuxt/a-module')
      expect(npmNames[1]).toBe('@nuxt/c-module')
      expect(npmNames[2]).toBe('@community/b-module')
      expect(npmNames[3]).toBe('@community/z-module')
    })
  })

  describe('module selection', () => {
    it('should return selected modules when user selects and exits', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      // Simulate: user selects first module, then presses Esc
      mockPrompts
        .mockResolvedValueOnce({ module: '@nuxt/ui' })
        .mockResolvedValueOnce({ module: undefined })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [
        createMockModule({ npm: '@nuxt/ui', name: 'ui' }),
        createMockModule({ npm: '@nuxt/icon', name: 'icon' }),
      ]

      const result = await selectModulesAutocomplete({ modules })

      expect(result.selected).toContain('@nuxt/ui')
      expect(result.selected).toHaveLength(1)
    })

    it('should allow toggling module selection (select then deselect)', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      // Simulate: select, deselect same module, then exit
      mockPrompts
        .mockResolvedValueOnce({ module: '@nuxt/ui' }) // Select
        .mockResolvedValueOnce({ module: '@nuxt/ui' }) // Deselect (toggle)
        .mockResolvedValueOnce({ module: undefined }) // Exit

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule({ npm: '@nuxt/ui', name: 'ui' })]

      const result = await selectModulesAutocomplete({ modules })

      expect(result.selected).toHaveLength(0)
    })

    it('should allow selecting multiple modules', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      mockPrompts
        .mockResolvedValueOnce({ module: '@nuxt/ui' })
        .mockResolvedValueOnce({ module: '@nuxt/icon' })
        .mockResolvedValueOnce({ module: '@nuxt/image' })
        .mockResolvedValueOnce({ module: undefined })

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

  describe('error handling', () => {
    it('should handle prompt errors gracefully', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      mockPrompts.mockRejectedValueOnce(new Error('User interrupted'))

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule()]
      const result = await selectModulesAutocomplete({ modules })

      // Should return empty array on error, not throw
      expect(result).toEqual({ selected: [], cancelled: false })
    })

    it('should not throw when prompt is interrupted', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      mockPrompts.mockRejectedValueOnce(new Error('Interrupted'))

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const modules = [createMockModule()]

      // Should not throw, should return gracefully
      await expect(selectModulesAutocomplete({ modules })).resolves.toEqual({
        selected: [],
        cancelled: false,
      })
    })
  })

  describe('custom message', () => {
    it('should use custom message when provided', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedMessage = ''
      mockPrompts.mockImplementation(async (options: any) => {
        capturedMessage = options.message
        return { module: undefined }
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
      mockPrompts.mockImplementation(async (options: any) => {
        capturedMessage = options.message
        return { module: undefined }
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [createMockModule()],
      })

      expect(capturedMessage).toBe('Search modules (Esc to finish):')
    })
  })

  describe('description truncation', () => {
    it('should truncate long descriptions', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      // Set narrow terminal
      Object.defineProperty(process.stdout, 'columns', {
        value: 60,
        writable: true,
        configurable: true,
      })

      let capturedChoices: any[] = []
      mockPrompts.mockImplementation(async (options: any) => {
        capturedChoices = options.choices
        return { module: undefined }
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      const longDescription = 'This is a very long description that should be truncated because it exceeds the maximum allowed length for the terminal width'
      await selectModulesAutocomplete({
        modules: [createMockModule({ description: longDescription })],
      })

      // Description should be truncated and end with ellipsis
      const choice = capturedChoices[0]
      expect(choice.description.length).toBeLessThan(longDescription.length)
      expect(choice.description.endsWith('…')).toBe(true)
    })
  })

  describe('fuzzy search suggest function', () => {
    it('should pass suggest function to prompts', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedSuggest: ((input: string, choices: any[]) => Promise<any[]>) | undefined
      mockPrompts.mockImplementation(async (options: any) => {
        capturedSuggest = options.suggest
        return { module: undefined }
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [
          createMockModule({ npm: '@nuxt/tailwind', name: 'tailwind' }),
          createMockModule({ npm: '@nuxt/ui', name: 'ui' }),
        ],
      })

      expect(capturedSuggest).toBeDefined()
      expect(typeof capturedSuggest).toBe('function')
    })

    it('should return all choices when input is empty', async () => {
      vi.doMock('std-env', () => ({
        hasTTY: true,
      }))

      let capturedSuggest: ((input: string, choices: any[]) => Promise<any[]>) | undefined
      let capturedChoices: any[] = []

      mockPrompts.mockImplementation(async (options: any) => {
        capturedSuggest = options.suggest
        capturedChoices = options.choices
        return { module: undefined }
      })

      const { selectModulesAutocomplete } = await import('../../../../src/commands/module/_autocomplete')

      await selectModulesAutocomplete({
        modules: [
          createMockModule({ npm: '@nuxt/a', name: 'a' }),
          createMockModule({ npm: '@nuxt/b', name: 'b' }),
        ],
      })

      // Test the suggest function with empty input
      const result = await capturedSuggest!('', capturedChoices)
      expect(result).toEqual(capturedChoices)
    })
  })
})
