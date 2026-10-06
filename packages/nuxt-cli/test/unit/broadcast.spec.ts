import { describe, expect, it, vi } from 'vitest'

import { openErrorBridge } from '../../src/dev/error-channel'
import { openDevLogChannel } from '../../src/dev/log-channel'
import { openDevSpanChannel } from '../../src/dev/span-channel'

vi.mock('node:worker_threads', async importOriginal => ({
  ...await importOriginal<typeof import('node:worker_threads')>(),
  BroadcastChannel: class {
    constructor() {
      throw new TypeError('Cannot read properties of undefined (reading \'on\')')
    }
  },
}))

describe('dev channels', () => {
  it.each([
    ['log', () => openDevLogChannel(() => {})],
    ['span', () => openDevSpanChannel(() => {})],
    ['error', () => openErrorBridge()],
  ])('should open and close the %s channel when `BroadcastChannel` cannot be constructed', (_, open) => {
    expect(() => open()()).not.toThrow()
  })
})
