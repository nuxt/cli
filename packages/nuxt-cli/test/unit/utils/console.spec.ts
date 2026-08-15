import process from 'node:process'

import { consola } from 'consola'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { restoreRawMode, withDirectStdout } from '../../../src/utils/console'

const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean, isRaw?: boolean }
const descriptors = Object.getOwnPropertyDescriptors(stdin)

const setRawMode = vi.fn(() => stdin)

function stubStdin(properties: { isTTY?: boolean, isRaw?: boolean }): void {
  setRawMode.mockClear()
  Object.defineProperty(stdin, 'setRawMode', { value: setRawMode, configurable: true, writable: true })
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(stdin, key, { value, configurable: true, writable: true })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const key of ['isTTY', 'isRaw', 'setRawMode'] as const) {
    if (descriptors[key]) {
      Object.defineProperty(stdin, key, descriptors[key])
    }
    else {
      delete (stdin as unknown as Record<string, unknown>)[key]
    }
  }
})

describe('restoreRawMode', () => {
  it('should do nothing when stdin is not a tty', () => {
    stubStdin({ isTTY: false })

    restoreRawMode()

    expect(setRawMode).not.toHaveBeenCalled()
  })

  it('should leave raw mode and resume a paused stdin', () => {
    stubStdin({ isTTY: true, isRaw: true })
    vi.spyOn(stdin, 'isPaused').mockReturnValue(true)
    const resume = vi.spyOn(stdin, 'resume').mockReturnValue(stdin)

    restoreRawMode()

    expect(resume).toHaveBeenCalled()
    expect(setRawMode).toHaveBeenCalledWith(false)
  })

  it('should not touch a tty that is already out of raw mode', () => {
    stubStdin({ isTTY: true, isRaw: false })
    vi.spyOn(stdin, 'isPaused').mockReturnValue(false)

    restoreRawMode()

    expect(setRawMode).not.toHaveBeenCalled()
  })
})

describe('withDirectStdout', () => {
  it('should run the callback unchanged when stdout is not wrapped', async () => {
    const restore = vi.spyOn(consola, 'restoreStd')

    await expect(withDirectStdout(() => 'result')).resolves.toBe('result')
    expect(restore).not.toHaveBeenCalled()
  })

  it('should unwrap stdout for the callback and wrap it again afterwards', async () => {
    const wrapped = process.stdout as typeof process.stdout & { __write?: typeof process.stdout.write }
    const original = wrapped.__write
    wrapped.__write = (() => true) as typeof process.stdout.write
    const restore = vi.spyOn(consola, 'restoreStd').mockImplementation(() => {})
    const wrap = vi.spyOn(consola, 'wrapStd').mockImplementation(() => {})

    try {
      await expect(withDirectStdout(() => 'result')).resolves.toBe('result')
      expect(restore).toHaveBeenCalled()
      expect(wrap).toHaveBeenCalled()
    }
    finally {
      wrapped.__write = original
    }
  })

  it('should wrap stdout again when the callback throws', async () => {
    const wrapped = process.stdout as typeof process.stdout & { __write?: typeof process.stdout.write }
    const original = wrapped.__write
    wrapped.__write = (() => true) as typeof process.stdout.write
    vi.spyOn(consola, 'restoreStd').mockImplementation(() => {})
    const wrap = vi.spyOn(consola, 'wrapStd').mockImplementation(() => {})

    try {
      await expect(withDirectStdout(() => {
        throw new Error('boom')
      })).rejects.toThrow('boom')
      expect(wrap).toHaveBeenCalled()
    }
    finally {
      wrapped.__write = original
    }
  })
})
