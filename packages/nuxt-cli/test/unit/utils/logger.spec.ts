import { afterEach, describe, expect, it, vi } from 'vitest'

import { stripAnsi } from '../../../src/utils/formatting'
import { logBlock, logger } from '../../../src/utils/logger'

const environment = vi.hoisted(() => ({ isCI: false }))

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  get isCI() {
    return environment.isCI
  },
}))

describe('logger', () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    restores.splice(0).forEach(restore => restore())
    environment.isCI = false
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

    return { written: () => stripAnsi(chunks.join('')) }
  }

  it('should leave no clack gutter in redirected output', () => {
    const { written } = capture(false)

    logger.info('Bundling app')
    logger.warn('Slow')

    expect(written()).toBe('● Bundling app\n▲ Slow\n')
  })

  it('should keep clack framing in a terminal', () => {
    const { written } = capture(true)

    logger.info('Bundling app')

    expect(written()).toContain('│\n')
  })

  it('should leave no clack gutter in CI, where nothing draws against it', () => {
    environment.isCI = true
    const { written } = capture(true)

    logger.info('Bundling app')

    expect(written()).toBe('● Bundling app\n')
  })

  it('should indent a continuation line under its symbol', () => {
    const { written } = capture(false)

    logger.info('Ready in 2.4s\nconfig 320ms')

    expect(written()).toBe('● Ready in 2.4s\n  config 320ms\n')
  })

  // Last in the file: the first block outside a terminal starts watching stdout for good.
  it('should keep summary blocks one blank line apart in a terminal', () => {
    const { written } = capture(true)

    logBlock('Bundle (client)\n_nuxt/entry.js')
    logBlock('Route rules\n/  prerender')
    logger.success('Server built')

    expect(written()).not.toMatch(/│\n│\n/)
    expect(written()).toMatch(/│ {2}_nuxt\/entry\.js\n│\n│ {2}Route rules\n.*\n│\n◆ {2}Server built\n$/)
  })

  it('should keep summary blocks one blank line apart in redirected output', () => {
    const { written } = capture(false)

    logger.info('Bundling app')
    logBlock('Bundle (client)\n_nuxt/entry.js')
    logBlock('Route rules\n/  prerender')
    logger.success('Server built')

    expect(written()).toBe('● Bundling app\n\nBundle (client)\n_nuxt/entry.js\n\nRoute rules\n/  prerender\n\n◆ Server built\n')
  })
})
