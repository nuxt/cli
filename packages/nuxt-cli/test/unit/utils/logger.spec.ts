import { afterEach, describe, expect, it, vi } from 'vitest'

import { stripAnsi } from '../../../src/dev/tui/width'
import { logger } from '../../../src/utils/logger'

describe('logger', () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    restores.splice(0).forEach(restore => restore())
    vi.restoreAllMocks()
  })

  function capture(isTTY: boolean): { written: () => string } {
    const original = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true })
    restores.push(() => Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true }))

    const chunks: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    })
    restores.push(() => write.mockRestore())

    return { written: () => chunks.join('') }
  }

  it('should leave no clack gutter in redirected output', () => {
    const { written } = capture(false)

    logger.info('Bundling app')
    logger.warn('Slow')

    const output = stripAnsi(written())
    expect(output).toBe('● Bundling app\n▲ Slow\n')
  })

  it('should keep clack framing in a terminal', () => {
    const { written } = capture(true)

    logger.info('Bundling app')

    expect(stripAnsi(written())).toContain('│\n')
  })

  it('should indent a continuation line under its symbol', () => {
    const { written } = capture(false)

    logger.info('Ready in 2.4s\nconfig 320ms')

    expect(stripAnsi(written())).toBe('● Ready in 2.4s\n  config 320ms\n')
  })
})
