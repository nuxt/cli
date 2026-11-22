import type { ConsolaOptions, LogObject, PromptOptions } from 'consola'

import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { consola, createConsola } from 'consola'
import { resolveModulePath } from 'exsolve'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { askQuestion, configureProjectConsola, interceptPrompts, reportThroughClack, restoreRawMode, routeProcessWarnings, withDirectStdout, wrapReporter } from '../../../src/utils/console'
import { stripAnsi } from '../../../src/utils/formatting'
import { logger } from '../../../src/utils/logger'
import { holdScreen, onScreenHeld, registerUnseenOutput } from '../../../src/utils/screen'
import { registerTerminalHost } from '../../../src/utils/terminal-host'

type PromptFn = NonNullable<ConsolaOptions['prompt']>

/** Whether the session has a terminal a question could be answered on. */
let interactive = true

const stdEnv = vi.hoisted(() => ({
  isCI: false,
}))

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  get isCI() {
    return stdEnv.isCI
  },
}))

vi.mock('../../../src/utils/resolve-nuxt', () => ({
  tryResolveNuxt: () => null,
}))

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

  it('should leave the keyboard to a question that is on screen', () => {
    stubStdin({ isTTY: true, isRaw: true })
    vi.spyOn(stdin, 'isPaused').mockReturnValue(false)

    const release = holdScreen()
    restoreRawMode()
    expect(setRawMode).not.toHaveBeenCalled()

    release()
    restoreRawMode()
    expect(setRawMode).toHaveBeenCalledWith(false)
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

describe('askQuestion', () => {
  function watchScreen() {
    const seen: boolean[] = []
    const off = onScreenHeld(held => seen.push(held))
    return { seen, off }
  }

  it('should take the screen for the question and give it back', async () => {
    const { seen, off } = watchScreen()
    try {
      await expect(askQuestion(async () => {
        expect(seen).toEqual([true])
        return 'answer'
      })).resolves.toBe('answer')
      expect(seen).toEqual([true, false])
    }
    finally {
      off()
    }
  })

  it('should give the screen back when the question throws', async () => {
    const { seen, off } = watchScreen()
    try {
      await expect(askQuestion(async () => {
        throw new Error('declined')
      })).rejects.toThrow('declined')
      expect(seen).toEqual([true, false])
    }
    finally {
      off()
    }
  })

  it('should hand raw mode back once the question is answered', async () => {
    stubStdin({ isTTY: true, isRaw: true })
    vi.spyOn(stdin, 'isPaused').mockReturnValue(false)

    await askQuestion(async () => 'answer')

    expect(setRawMode).toHaveBeenCalledWith(false)
  })

  it('should hand the keyboard back before the host resumes its own reader', async () => {
    stubStdin({ isTTY: true, isRaw: false })
    vi.spyOn(stdin, 'isPaused').mockReturnValue(false)
    const order: string[] = []
    setRawMode.mockImplementation(() => {
      order.push('raw')
      return stdin
    })
    const release = registerTerminalHost({
      version: 1,
      startTask: () => ({
        update: () => {},
        stop: () => {},
      }),
      withTerminal: async (work) => {
        try {
          return await work()
        }
        finally {
          Object.defineProperty(stdin, 'isRaw', { value: true, configurable: true, writable: true })
          order.push('resume')
        }
      },
    })

    try {
      await askQuestion(async () => {
        Object.defineProperty(stdin, 'isRaw', { value: true, configurable: true, writable: true })
        order.push('ask')
      })
    }
    finally {
      release()
    }

    expect(order).toEqual(['ask', 'raw', 'resume'])
  })
})

describe('interceptPrompts', () => {
  /** Resolvers for the questions asked so far, most recent last. */
  let resolvers: Array<(value: unknown) => void> = []

  const pending = () => new Promise<unknown>(resolve => resolvers.push(resolve))

  const ask = (options: PromptOptions = {}) => {
    const prompt = vi.fn(pending) as unknown as PromptFn
    const instance = {
      options: { prompt },
    }
    interceptPrompts(instance)
    return {
      prompt,
      answer: () => instance.options.prompt('Install it?', options),
    }
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
      startTask: () => ({
        update: () => {},
        stop: () => {},
      }),
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

  it('should wait for a stdin query to be answered before asking', async () => {
    const { holdStdin } = await import('../../../src/utils/stdin')
    const release = holdStdin()
    try {
      const { prompt, answer } = ask({ type: 'confirm' })

      const answered = answer()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(prompt).not.toHaveBeenCalled()

      release()
      await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
      resolvers.pop()!(true)
      await expect(answered).resolves.toBe(true)
    }
    finally {
      release()
    }
  })

  it('should ask one question at a time', async () => {
    const first = ask({ type: 'confirm' })
    const second = ask({ type: 'confirm' })

    const answers = [
      first.answer(),
      second.answer(),
    ]
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalled())
    expect(second.prompt).not.toHaveBeenCalled()

    resolvers.pop()!(false)
    await vi.waitFor(() => expect(second.prompt).toHaveBeenCalled())
    resolvers.pop()!(true)

    await expect(Promise.all(answers)).resolves.toEqual([false, true])
  })

  it('should show what was held back ahead of a question before asking it', async () => {
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })
    const withdraw = registerUnseenOutput(() => '\n\u2139 Nuxt collects anonymous data.\n  Read more online.\n\n')
    try {
      const { prompt, answer } = ask({ type: 'confirm' })
      vi.mocked(prompt).mockImplementationOnce(async () => written.join(''))

      await expect(answer()).resolves.toBe('\n\u2139 Nuxt collects anonymous data.\n  Read more online.\n')
    }
    finally {
      withdraw()
    }
  })

  it('should show what was held back when a question was raised, however long it waits to be asked', async () => {
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })
    let unseen = ''
    const withdraw = registerUnseenOutput(() => unseen)
    try {
      const first = ask({ type: 'confirm' })
      const second = ask({ type: 'confirm' })

      const answers = [
        first.answer(),
      ]
      unseen = 'What the second question is about.\n'
      answers.push(second.answer())
      unseen = ''

      await vi.waitFor(() => expect(first.prompt).toHaveBeenCalled())
      expect(written.join('')).toBe('')
      resolvers.pop()!(false)
      await vi.waitFor(() => expect(second.prompt).toHaveBeenCalled())
      expect(written.join('')).toBe('\nWhat the second question is about.\n')
      resolvers.pop()!(true)

      await Promise.all(answers)
    }
    finally {
      withdraw()
    }
  })

  it('should leave an already intercepted prompt alone', () => {
    const instance = {
      options: {
        prompt: vi.fn(pending) as unknown as PromptFn,
      },
    }
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

describe('routeProcessWarnings', () => {
  it('should log a process warning printed through the console as a warning', () => {
    const logs: LogObject[] = []
    const instance = createConsola({
      reporters: [
        {
          log: logObj => void logs.push(logObj),
        },
      ],
    })
    routeProcessWarnings(instance)
    instance.wrapConsole()
    try {
      console.error('(node:1234) [DEP0000] DeprecationWarning: deprecated')
      console.error('boom')
    }
    finally {
      instance.restoreConsole()
    }

    expect(logs).toMatchObject([
      {
        type: 'warn',
        level: 1,
        args: ['(node:1234) [DEP0000] DeprecationWarning: deprecated'],
      },
      {
        type: 'error',
        level: 0,
        args: ['boom'],
      },
    ])
  })
})

describe('reportThroughClack', () => {
  const stdout = process.stdout as Omit<NodeJS.WriteStream, 'isTTY'> & { isTTY?: boolean }
  const isTTY = Object.getOwnPropertyDescriptor(stdout, 'isTTY')
  let stop = () => {}

  afterEach(() => {
    stop()
    stdEnv.isCI = false
    if (isTTY) {
      Object.defineProperty(stdout, 'isTTY', isTTY)
    }
    else {
      delete stdout.isTTY
    }
  })

  function setup(options: { tty?: boolean } = {}) {
    Object.defineProperty(stdout, 'isTTY', { value: options.tty ?? true, configurable: true, writable: true })
    const original = {
      log: vi.fn(),
    }
    const instance = createConsola({
      reporters: [
        wrapReporter(original),
      ],
      level: 5,
    })
    const calls: Array<[method: string, message: string]> = []
    for (const method of [
      'error',
      'warn',
      'success',
      'info',
      'message',
    ] as const) {
      vi.spyOn(logger, method).mockImplementation((message?: string) => void calls.push([
        method,
        stripAnsi(String(message)),
      ]))
    }
    return { original, instance, calls }
  }

  it('renders each consola type with the matching clack log method', () => {
    const { original, instance, calls } = setup()
    stop = reportThroughClack()

    instance.error('boom')
    instance.fail('broken')
    instance.warn('slow')
    instance.success('done')
    instance.ready('ready')
    instance.info('Building', 'app')
    instance.start('starting')
    instance.log('plain')
    instance.debug('detail')

    expect(original.log).not.toHaveBeenCalled()
    expect(calls).toEqual([
      ['error', 'boom'],
      ['error', 'broken'],
      ['warn', 'slow'],
      ['success', 'done'],
      ['success', 'ready'],
      ['info', 'Building app'],
      ['info', 'starting'],
      ['message', 'plain'],
      ['message', 'detail'],
    ])
  })

  it('prefixes the tag and formats the message with the wrapped reporter', () => {
    const { instance, calls } = setup()
    const fancy = {
      log: vi.fn(),
      formatArgs: (args: unknown[]) => `formatted ${args.join(' ')}`,
    }
    instance.setReporters([
      wrapReporter(fancy),
    ])
    stop = reportThroughClack()

    instance.withTag('site-data').info('Using `cached` data')

    expect(calls).toEqual([
      ['info', '[site-data] formatted Using cached data'],
    ])
  })

  it('writes past consola\'s stdout wrapper', () => {
    Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true, writable: true })
    const written: string[] = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(stripAnsi(String(chunk)))
      return true
    })
    const original = {
      log: vi.fn(),
    }
    const instance = createConsola({
      reporters: [
        wrapReporter(original),
      ],
      level: 5,
    })
    instance.wrapStd()
    stop = reportThroughClack()
    try {
      instance.error('boom')
      instance.warn('slow')
      instance.success('done')
      instance.info('Building app')
      instance.log('plain')
    }
    finally {
      instance.restoreStd()
      write.mockRestore()
    }

    expect(original.log).not.toHaveBeenCalled()
    const output = written.join('')
    expect(output).toContain('■  boom')
    expect(output).toContain('▲  slow')
    expect(output).toContain('◆  done')
    expect(output).toContain('●  Building app')
    expect(output).toContain('│  plain')
  })

  it('leaves the CLI\'s own logs, handed back by consola\'s stdout wrapper, to the wrapped reporter', () => {
    Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true, writable: true })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const original = {
      log: vi.fn(),
    }
    const instance = createConsola({
      reporters: [
        wrapReporter(original),
      ],
      level: 5,
    })
    instance.wrapStd()
    stop = reportThroughClack()
    try {
      logger.info('Deploy target: static')
    }
    finally {
      instance.restoreStd()
      write.mockRestore()
    }

    expect(original.log).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        expect.stringContaining('Deploy target: static'),
      ],
    }), expect.anything())
  })

  it('leaves boxes to the wrapped reporter', () => {
    const { original, instance, calls } = setup()
    stop = reportThroughClack()

    instance.box('Hello')

    expect(calls).toEqual([])
    expect(original.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'box' }), expect.anything())
  })

  it('leaves traces to the wrapped reporter, which prints their stack', () => {
    const { calls } = setup()
    const fancyOptions = { fancy: true, level: 5 }
    const fancy = createConsola(fancyOptions).options.reporters[0]!
    const written: string[] = []
    const stdout = {
      write: (chunk: string) => void written.push(stripAnsi(chunk)),
    }
    const instance = createConsola({
      reporters: [
        wrapReporter(fancy),
      ],
      level: 5,
      stdout: stdout as unknown as NodeJS.WriteStream,
    })
    stop = reportThroughClack()

    instance.trace('checkpoint')

    expect(calls).toEqual([])
    expect(written.join('')).toContain('checkpoint')
    expect(written.join('')).toMatch(/^ +at /m)
  })

  it('stops once switched off', () => {
    const { original, instance, calls } = setup()
    reportThroughClack()()

    instance.info('after')

    expect(calls).toEqual([])
    expect(original.log).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'stdout is not a terminal',
      { tty: false, ci: false },
    ],
    [
      'running in CI',
      { tty: true, ci: true },
    ],
  ])('does nothing when %s', (_, { tty, ci }) => {
    const { original, instance, calls } = setup({ tty })
    stdEnv.isCI = ci
    stop = reportThroughClack()

    instance.warn('slow')

    expect(calls).toEqual([])
    expect(original.log).toHaveBeenCalledOnce()
  })
})

describe('configureProjectConsola', () => {
  it('should send logs from a separate project consola through the CLI\'s reporters', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nuxt-cli-consola-')))
    const reporters = consola.options.reporters
    try {
      cpSync(dirname(dirname(resolveModulePath('consola', { from: import.meta.url }))), join(root, 'node_modules/consola'), { recursive: true, dereference: true })
      await configureProjectConsola(root)
      const { consola: project } = await import(pathToFileURL(resolveModulePath('consola', { from: root })).href) as { consola: typeof consola }
      const logs: LogObject[] = []
      consola.options.reporters = [
        {
          log: logObj => void logs.push(logObj),
        },
      ]

      project.withTag('@nuxt/robots').warn('You have disallowed robots')

      expect(project).not.toBe(consola)
      expect(logs).toMatchObject([
        {
          type: 'warn',
          tag: '@nuxt/robots',
          args: ['You have disallowed robots'],
        },
      ])
    }
    finally {
      consola.options.reporters = reporters
      rmSync(root, { recursive: true, force: true })
    }
  })
})
