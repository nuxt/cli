import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'
import { createSpinner, withSpinner } from '../../../src/utils/spinner'
import { registerTerminalHost } from '../../../src/utils/terminal-host'

const realIsTTY = process.stdout.isTTY

afterEach(() => {
  process.stdout.isTTY = realIsTTY
  vi.restoreAllMocks()
})

describe('withSpinner', () => {
  it('should log each stage as a line without a terminal to animate', async () => {
    process.stdout.isTTY = false
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const success = vi.spyOn(logger, 'success').mockImplementation(() => {})

    const result = await withSpinner('Searching', async (spinner) => {
      spinner.update('Downloading')
      spinner.done('Searched 3 pages')
      return 'done'
    }, { done: 'Searched' })

    expect(result).toBe('done')
    expect(info.mock.calls.map(call => call[0])).toEqual(['Searching...', 'Downloading...'])
    expect(success.mock.calls.map(call => call[0])).toEqual(['Searched 3 pages'])
  })
})

describe('createSpinner', () => {
  it('should log each distinct message once without a terminal to animate', () => {
    process.stdout.isTTY = false
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const success = vi.spyOn(logger, 'success').mockImplementation(() => {})

    const spinner = createSpinner({ indicator: 'timer' })
    spinner.start('Installing with pnpm')
    spinner.message('`pnpm add` may be stuck')
    spinner.message('`pnpm add` may be stuck')
    spinner.stop('Dependencies installed')

    expect(info.mock.calls.map(call => call[0])).toEqual(['Installing with pnpm...', '`pnpm add` may be stuck...'])
    expect(success.mock.calls.map(call => call[0])).toEqual(['Dependencies installed'])
    expect(write).not.toHaveBeenCalled()
  })
})

describe('spinners with a terminal host', () => {
  function recordingHost() {
    const calls: string[] = []
    const host = {
      version: 1 as const,
      withTerminal: <T>(work: () => Promise<T>) => work(),
      startTask: (label: string) => {
        calls.push(`start ${label}`)
        return {
          update: (text: string) => void calls.push(`update ${text}`),
          stop: (message?: string, outcome?: string) => void calls.push(`stop ${outcome} ${message}`),
        }
      },
    }
    return { host, calls }
  }

  it('should report withSpinner work as a task instead of animating', async () => {
    const { host, calls } = recordingHost()
    const release = registerTerminalHost(host)

    try {
      const result = await withSpinner('Searching', async (spinner) => {
        spinner.update('Downloading')
        spinner.done('Searched 3 pages')
        return 'done'
      })

      expect(result).toBe('done')
      expect(calls).toEqual(['start Searching', 'update Downloading', 'stop success Searched 3 pages'])
    }
    finally {
      release()
    }
  })

  it('should report work that throws as a failed task', async () => {
    const { host, calls } = recordingHost()
    const release = registerTerminalHost(host)

    try {
      await expect(withSpinner('Searching', async () => {
        throw new Error('boom')
      }, { done: 'Searched' })).rejects.toThrow('boom')

      expect(calls).toEqual(['start Searching', 'stop failure undefined'])
    }
    finally {
      release()
    }
  })

  it('should route a created spinner through the host task', () => {
    const { host, calls } = recordingHost()
    const release = registerTerminalHost(host)

    try {
      const spinner = createSpinner({ indicator: 'timer' })
      spinner.start('Installing with pnpm')
      spinner.message('Resolving packages')
      spinner.stop('Dependencies installed')

      const failing = createSpinner()
      failing.start('Installing with pnpm')
      failing.error('Install failed')

      expect(calls).toEqual([
        'start Installing with pnpm',
        'update Resolving packages',
        'stop success Dependencies installed',
        'start Installing with pnpm',
        'stop failure Install failed',
      ])
    }
    finally {
      release()
    }
  })
})
