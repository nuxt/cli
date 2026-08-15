import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '../../../src/utils/logger'
import { withSpinner } from '../../../src/utils/spinner'

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
