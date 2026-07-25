import { describe, expect, it } from 'vitest'

import { formatDuration } from '../../../src/utils/formatting'

describe('formatDuration', () => {
  it('should render sub-second durations in milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(12.4)).toBe('12ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('should render seconds above a second', () => {
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(1234)).toBe('1.23s')
    expect(formatDuration(9999)).toBe('10s')
    expect(formatDuration(12_300)).toBe('12.3s')
    expect(formatDuration(59_000)).toBe('59s')
  })

  it('should render minutes and seconds above a minute', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(3_600_000)).toBe('60m')
  })
})
