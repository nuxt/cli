import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stdEnv = vi.hoisted(() => ({ isCI: false, isTest: false, provider: 'unknown' as string }))
const rcStore = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const project = vi.hoisted(() => ({ nuxtVersion: undefined as string | undefined }))
const fetchMock = vi.hoisted(() => vi.fn())
const registry = vi.hoisted(() => ({ current: { registry: 'https://registry.npmjs.org', authToken: null as string | null } }))

vi.mock('std-env', async (importOriginal) => {
  const original = await importOriginal<typeof import('std-env')>()
  return {
    ...original,
    get isCI() {
      return stdEnv.isCI
    },
    get isTest() {
      return stdEnv.isTest
    },
    get provider() {
      return stdEnv.provider
    },
  }
})

vi.mock('rc9', async () => {
  const { defu } = await import('defu')
  return {
    readUser: () => rcStore.current,
    updateUser: (value: Record<string, unknown>) => {
      rcStore.current = defu(value, rcStore.current)
    },
  }
})

vi.mock('../../../src/utils/fetch', () => ({ fetchJson: fetchMock }))

vi.mock('../../../src/utils/registry', () => ({
  detectNpmRegistry: async () => registry.current,
}))

vi.mock('pkg-types', () => ({
  readPackageJSON: async (id?: string) => {
    if (id === 'nuxt') {
      return project.nuxtVersion ? { name: 'nuxt', version: project.nuxtVersion } : undefined
    }
    throw new Error('package.json not found')
  },
}))

const { isUpdateCheckEnabled, renderSelfUpdateNudge, renderUpdateNudge, scheduleSelfUpdateNudge } = await import('../../../src/utils/update-check')
const { checkForNuxtUpdate, scheduleUpdateNudge } = await import('../../../src/utils/update')

describe('update check', () => {
  const originalIsTTY = process.stdout.isTTY

  beforeEach(() => {
    stdEnv.isCI = false
    stdEnv.isTest = false
    stdEnv.provider = 'unknown'
    rcStore.current = {}
    project.nuxtVersion = '4.0.0'
    registry.current = { registry: 'https://registry.npmjs.org', authToken: null }
    fetchMock.mockReset()
    process.stdout.isTTY = true
    delete process.env.NUXT_IGNORE_UPDATE_CHECK
    delete process.env.NO_UPDATE_NOTIFIER
  })

  afterEach(() => {
    process.stdout.isTTY = originalIsTTY
    delete process.env.NUXT_IGNORE_UPDATE_CHECK
    delete process.env.NO_UPDATE_NOTIFIER
  })

  describe('isUpdateCheckEnabled', () => {
    it('is enabled on an interactive local terminal', () => {
      expect(isUpdateCheckEnabled()).toBe(true)
    })

    it('is disabled in CI', () => {
      stdEnv.isCI = true
      expect(isUpdateCheckEnabled()).toBe(false)
    })

    it('is disabled without a TTY', () => {
      process.stdout.isTTY = false
      expect(isUpdateCheckEnabled()).toBe(false)
    })

    it('is disabled on stackblitz', () => {
      stdEnv.provider = 'stackblitz'
      expect(isUpdateCheckEnabled()).toBe(false)
    })

    it('is disabled by NUXT_IGNORE_UPDATE_CHECK', () => {
      process.env.NUXT_IGNORE_UPDATE_CHECK = '1'
      expect(isUpdateCheckEnabled()).toBe(false)
    })

    it('is disabled by NO_UPDATE_NOTIFIER', () => {
      process.env.NO_UPDATE_NOTIFIER = '1'
      expect(isUpdateCheckEnabled()).toBe(false)
    })

    it('is disabled by a persisted opt-out', () => {
      rcStore.current = { updateCheck: { enabled: false } }
      expect(isUpdateCheckEnabled()).toBe(false)
    })
  })

  describe('checkForNuxtUpdate', () => {
    it('reports a newer release', async () => {
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await expect(checkForNuxtUpdate('/project')).resolves.toEqual({ current: '4.0.0', latest: '4.1.0' })
    })

    it('returns nothing when already up to date', async () => {
      fetchMock.mockResolvedValue({ latest: '4.0.0' })
      await expect(checkForNuxtUpdate('/project')).resolves.toBeUndefined()
    })

    it('returns nothing when the installed version is ahead', async () => {
      project.nuxtVersion = '4.2.0'
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await expect(checkForNuxtUpdate('/project')).resolves.toBeUndefined()
    })

    it('stays quiet when only a few patches behind', async () => {
      fetchMock.mockResolvedValue({ latest: '4.0.3' })
      await expect(checkForNuxtUpdate('/project')).resolves.toBeUndefined()
    })

    it('reports a distant patch release', async () => {
      fetchMock.mockResolvedValue({ latest: '4.0.7' })
      await expect(checkForNuxtUpdate('/project')).resolves.toEqual({ current: '4.0.0', latest: '4.0.7' })
    })

    it('reports a patch release in a newer minor', async () => {
      fetchMock.mockResolvedValue({ latest: '4.1.1' })
      await expect(checkForNuxtUpdate('/project')).resolves.toEqual({ current: '4.0.0', latest: '4.1.1' })
    })

    it('returns nothing when the installed version is a prerelease', async () => {
      project.nuxtVersion = '4.1.0-rc.1'
      fetchMock.mockResolvedValue({ latest: '4.2.0' })
      await expect(checkForNuxtUpdate('/project')).resolves.toBeUndefined()
    })

    it('queries the configured registry with its auth token', async () => {
      registry.current = { registry: 'https://npm.example.com/', authToken: 'secret' }
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await checkForNuxtUpdate('/project')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://npm.example.com/-/package/nuxt/dist-tags',
        expect.objectContaining({ headers: { Authorization: 'Bearer secret' } }),
      )
    })

    it('is silent when the network is unavailable', async () => {
      fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND registry.npmjs.org'))
      await expect(checkForNuxtUpdate('/project')).resolves.toBeUndefined()
    })

    it('does not retry the registry until the cache expires after a failure', async () => {
      fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND registry.npmjs.org'))
      await checkForNuxtUpdate('/project')
      await checkForNuxtUpdate('/project')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry the registry until the cache expires when no dist-tag is published', async () => {
      fetchMock.mockResolvedValue({})
      await checkForNuxtUpdate('/project')
      await checkForNuxtUpdate('/project')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('is silent when the installed version cannot be resolved', async () => {
      project.nuxtVersion = undefined
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await expect(checkForNuxtUpdate('/project')).resolves.toBeUndefined()
    })

    it('persists the result to the user rc file', async () => {
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await checkForNuxtUpdate('/project')
      expect(rcStore.current.updateCheck).toMatchObject({ latest: '4.1.0' })
    })

    it('preserves a persisted opt-in when caching the result', async () => {
      rcStore.current = { updateCheck: { enabled: true } }
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await checkForNuxtUpdate('/project')
      expect(rcStore.current.updateCheck).toMatchObject({ enabled: true, latest: '4.1.0' })
    })

    it('uses a fresh cache without fetching', async () => {
      rcStore.current = { updateCheck: { latest: '4.1.0', checkedAt: Date.now() } }
      await expect(checkForNuxtUpdate('/project')).resolves.toEqual({ current: '4.0.0', latest: '4.1.0' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refetches when the cache is stale', async () => {
      rcStore.current = { updateCheck: { latest: '4.1.0', checkedAt: Date.now() - 25 * 60 * 60 * 1000 } }
      fetchMock.mockResolvedValue({ latest: '4.2.0' })
      await expect(checkForNuxtUpdate('/project')).resolves.toEqual({ current: '4.0.0', latest: '4.2.0' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('fetches when there is no cache', async () => {
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await checkForNuxtUpdate('/project')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('scheduleUpdateNudge', () => {
    it('does not check when disabled', async () => {
      stdEnv.isCI = true
      await scheduleUpdateNudge('/project')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each(['upgrade', 'init'])('does not check when running the %s command', async (command) => {
      await scheduleUpdateNudge('/project', command)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('defers the nudge to process exit when an update is available', async () => {
      const once = vi.spyOn(process, 'once')
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      await scheduleUpdateNudge('/project')
      expect(once).toHaveBeenCalledWith('exit', expect.any(Function))
      for (const [event, listener] of once.mock.calls) {
        process.off(event as string, listener as () => void)
      }
      once.mockRestore()
    })

    it('registers nothing when up to date', async () => {
      const once = vi.spyOn(process, 'once')
      fetchMock.mockResolvedValue({ latest: '4.0.0' })
      await scheduleUpdateNudge('/project')
      expect(once).not.toHaveBeenCalled()
      once.mockRestore()
    })
  })

  describe('scheduleSelfUpdateNudge', () => {
    it('checks the given package rather than the project', async () => {
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      const once = vi.spyOn(process, 'once')
      await scheduleSelfUpdateNudge('create-nuxt', '4.0.0', { name: 'create-nuxt', command: 'pnpm create nuxt@latest' })
      expect(fetchMock.mock.calls[0]![0]).toContain('/-/package/create-nuxt/dist-tags')
      expect(once).toHaveBeenCalledWith('exit', expect.any(Function))
      for (const [event, listener] of once.mock.calls) {
        process.off(event as string, listener as () => void)
      }
      once.mockRestore()
    })

    it('does not nudge when the caller declines', async () => {
      fetchMock.mockResolvedValue({ latest: '4.1.0' })
      const once = vi.spyOn(process, 'once')
      await scheduleSelfUpdateNudge('create-nuxt', '4.0.0', { shouldNudge: () => false })
      expect(once).not.toHaveBeenCalled()
      once.mockRestore()
    })

    it('does not ask the caller when already up to date', async () => {
      fetchMock.mockResolvedValue({ latest: '4.0.0' })
      const shouldNudge = vi.fn(() => true)
      await scheduleSelfUpdateNudge('create-nuxt', '4.0.0', { shouldNudge })
      expect(shouldNudge).not.toHaveBeenCalled()
    })

    it('caches a package check separately from the nuxt one', async () => {
      rcStore.current = { updateCheck: { latest: '4.9.0', checkedAt: Date.now() } }
      fetchMock.mockResolvedValue({ latest: '4.0.0' })
      await scheduleSelfUpdateNudge('create-nuxt', '4.0.0', {})
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect((rcStore.current.updateCheck as any).packages['create-nuxt'].latest).toBe('4.0.0')
    })
  })

  describe('renderSelfUpdateNudge', () => {
    it('tells the user what to run next time, without a box', () => {
      const chunks: string[] = []
      const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        chunks.push(String(chunk))
        return true
      })
      renderSelfUpdateNudge({ current: '4.4.6', latest: '4.5.1' }, { name: 'create-nuxt', command: 'pnpm create nuxt@latest' })
      write.mockRestore()
      const output = chunks.join('')
      expect(output).toContain('a new version of create-nuxt is available: 4.5.1')
      expect(output).toContain('(you are on 4.4.6)')
      expect(output).toContain('next time, run pnpm create nuxt@latest to use the latest version')
      expect(output).not.toContain('╭')
    })
  })

  describe('renderUpdateNudge', () => {
    const originalColumns = process.stdout.columns

    function captureNudge(columns: number, options?: { name?: string, command?: string }) {
      const chunks: string[] = []
      process.stdout.columns = columns
      const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        chunks.push(String(chunk))
        return true
      })
      renderUpdateNudge({ current: '4.0.0', latest: '4.1.0' }, options)
      write.mockRestore()
      process.stdout.columns = originalColumns
      return chunks.join('')
    }

    it('shows both versions and the upgrade command without a box', () => {
      const output = captureNudge(100)
      expect(output).toContain('a new version of Nuxt is available: 4.1.0')
      expect(output).toContain('(you are on 4.0.0)')
      expect(output).toContain('run nuxt upgrade to update')
      expect(output).not.toContain('╭')
    })

    it('shows a custom package name and command', () => {
      const output = captureNudge(100, { name: 'create-nuxt', command: 'pnpm create nuxt@latest' })
      expect(output).toContain('create-nuxt')
      expect(output).toContain('pnpm create nuxt@latest')
    })

    it('does not depend on the terminal width', () => {
      const output = captureNudge(0)
      expect(output).toContain('4.1.0')
      expect(output).toContain('nuxt upgrade')
      expect(output).not.toContain('╭')
    })
  })
})
