import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'
import { createSpinner, withSpinner } from '../../../src/utils/spinner'
import { registerTerminalHost } from '../../../src/utils/terminal-host'

const realIsTTY = process.stdout.isTTY

afterEach(() => {
  process.stdout.isTTY = realIsTTY
})

describe('withSpinner', () => {
  it('should log each stage as a line without a terminal to animate', async () => {
    process.stdout.isTTY = false
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})

    const result = await withSpinner('Searching', async (spinner) => {
      spinner.update('Downloading')
      spinner.done('Searched 3 pages')
      return 'done'
    }, { done: 'Searched' })

    expect(result).toBe('done')
    expect(info.mock.calls.map(call => call[0])).toEqual(['Searching...', 'Downloading...', 'Searched 3 pages'])
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

  it('should hand out a clack spinner when nothing owns the terminal', () => {
    const spinner = createSpinner()

    expect(typeof spinner.start).toBe('function')
    expect(typeof spinner.message).toBe('function')
    expect(typeof spinner.stop).toBe('function')
  })
})
