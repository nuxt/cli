import process from 'node:process'
import { defineCommand } from 'citty'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { askQuestion } from '../../src/utils/console'

vi.mock('../../src/main', () => ({
  main: defineCommand({
    meta: { name: 'nuxt' },
    async run() {
      // The answer to a question such as `nuxt module remove`'s peer prompt.
      await askQuestion(() => Promise.resolve(true))
    },
  }),
}))

vi.mock('../../src/utils/hang', () => ({
  warnOnHang: vi.fn(),
}))

const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean, isRaw?: boolean }
const descriptors = Object.getOwnPropertyDescriptors(stdin)
const argv = process.argv

function stubTtyStdin() {
  for (const [key, value] of Object.entries({
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(() => stdin),
  })) {
    Object.defineProperty(stdin, key, { value, configurable: true, writable: true })
  }
  // A question's prompt pauses stdin when it closes, and `askQuestion` resumes it.
  let paused = true
  vi.spyOn(stdin, 'isPaused').mockImplementation(() => paused)
  const resume = vi.spyOn(stdin, 'resume').mockImplementation(() => {
    paused = false
    return stdin
  })
  vi.spyOn(stdin, 'pause').mockImplementation(() => {
    paused = true
    return stdin
  })
  const unref = vi.spyOn(stdin, 'unref').mockImplementation(() => stdin)
  return {
    resume,
    unref,
    isPaused: () => paused,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  process.argv = argv
  for (const key of ['isTTY', 'isRaw', 'setRawMode'] as const) {
    if (descriptors[key]) {
      Object.defineProperty(stdin, key, descriptors[key])
    }
    else {
      delete (stdin as unknown as Record<string, unknown>)[key]
    }
  }
})

describe('runMain', () => {
  it('should give stdin up once a command that asked a question is done', async () => {
    const { runMain, setCurrentCommand } = await import('../../src/run')
    const tty = stubTtyStdin()
    process.argv = ['node', 'nuxt']
    setCurrentCommand('module')

    await runMain()

    expect(tty.resume).toHaveBeenCalled()
    expect(tty.isPaused()).toBe(true)
    expect(tty.unref).toHaveBeenCalled()
  })

  it('should leave stdin to a command that keeps running', async () => {
    const { runMain, setCurrentCommand } = await import('../../src/run')
    const tty = stubTtyStdin()
    process.argv = ['node', 'nuxt']
    setCurrentCommand('dev')

    await runMain()

    expect(tty.isPaused()).toBe(false)
    expect(tty.unref).not.toHaveBeenCalled()
  })
})
