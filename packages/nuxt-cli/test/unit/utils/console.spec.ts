import type { ConsolaOptions, PromptOptions } from 'consola'

import process from 'node:process'

import { consola } from 'consola'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { interceptPrompts, restoreRawMode, withDirectStdout } from '../../../src/utils/console'
import { registerTerminalHost } from '../../../src/utils/terminal-host'

type PromptFn = NonNullable<ConsolaOptions['prompt']>

/** Whether the session has a terminal a question could be answered on. */
let interactive = true

vi.mock('../../../src/utils/stdout', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/stdout')>(),
  isInteractiveSession: () => interactive,
}))

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

describe('interceptPrompts', () => {
  /** Resolvers for the questions asked so far, most recent last. */
  let resolvers: Array<(value: unknown) => void> = []

  const pending = () => new Promise<unknown>(resolve => resolvers.push(resolve))

  const ask = (options: PromptOptions = {}) => {
    const prompt = vi.fn(pending) as unknown as PromptFn
    const instance = { options: { prompt } }
    interceptPrompts(instance)
    return { prompt, answer: () => instance.options.prompt('Install it?', options) }
  }

  afterEach(() => {
    interactive = true
    resolvers = []
  })

  it('should answer for a session with no terminal to ask on', async () => {
    interactive = false
    const confirm = ask({ type: 'confirm' })
    const text = ask()

    await expect(confirm.answer()).resolves.toBe(false)
    await expect(text.answer()).resolves.toBeUndefined()
    expect(confirm.prompt).not.toHaveBeenCalled()
    expect(text.prompt).not.toHaveBeenCalled()
  })

  it('should hand the terminal to the registered host for the question', async () => {
    const events: string[] = []
    const release = registerTerminalHost({
      version: 1,
      startTask: () => ({ update: () => {}, stop: () => {} }),
      withTerminal: async (work) => {
        events.push('suspend')
        try {
          return await work()
        }
        finally {
          events.push('restore')
        }
      },
    })

    try {
      const { prompt, answer } = ask({ type: 'confirm' })
      const pending = answer()
      await vi.waitFor(() => expect(prompt).toHaveBeenCalled())
      expect(events).toEqual(['suspend'])
      resolvers.pop()!(true)
      await expect(pending).resolves.toBe(true)
      expect(events).toEqual(['suspend', 'restore'])
    }
    finally {
      release()
    }
  })

  it('should ask one question at a time', async () => {
    const first = ask({ type: 'confirm' })
    const second = ask({ type: 'confirm' })

    const answers = [first.answer(), second.answer()]
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalled())
    expect(second.prompt).not.toHaveBeenCalled()

    resolvers.pop()!(false)
    await vi.waitFor(() => expect(second.prompt).toHaveBeenCalled())
    resolvers.pop()!(true)

    await expect(Promise.all(answers)).resolves.toEqual([false, true])
  })

  it('should leave an already intercepted prompt alone', () => {
    const instance = { options: { prompt: vi.fn(pending) as unknown as PromptFn } }
    interceptPrompts(instance)
    const wrapped = instance.options.prompt
    interceptPrompts(instance)

    expect(instance.options.prompt).toBe(wrapped)
  })

  it('should do nothing for an instance that cannot prompt', () => {
    const instance: { options: { prompt?: PromptFn } } = { options: {} }
    interceptPrompts(instance)

    expect(instance.options.prompt).toBeUndefined()
  })
})
