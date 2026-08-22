import { Buffer } from 'node:buffer'
import process from 'node:process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Background = typeof import('../../src/dev/tui/background')
type Theme = typeof import('../../src/utils/terminal-theme')

/** A tty that answers with `reply`, or stays silent when given nothing. */
function stubStdin(reply?: string) {
  const listeners = new Set<(chunk: Buffer) => void>()
  const calls = { raw: [] as boolean[], paused: false, resumed: false, unshifted: [] as string[] }
  return {
    calls,
    /** Send bytes as if the user or the terminal had, after the query. */
    emit: (text: string) => {
      for (const listener of listeners) {
        listener(Buffer.from(text, 'latin1'))
      }
    },
    reply,
    stdin: {
      isTTY: true,
      isRaw: false,
      setRawMode: (raw: boolean) => calls.raw.push(raw),
      isPaused: () => false,
      resume: () => {
        calls.resumed = true
      },
      pause: () => {
        calls.paused = true
      },
      unshift: (chunk: Buffer) => calls.unshifted.push(chunk.toString('latin1')),
      on: (_event: 'data', listener: (chunk: Buffer) => void) => listeners.add(listener),
      off: (_event: 'data', listener: (chunk: Buffer) => void) => listeners.delete(listener),
    },
  }
}

describe('terminal background query', () => {
  let queryBackground: Background['queryBackground']
  let stopBackgroundQuery: Background['stopBackgroundQuery']
  let resolveBackground: Theme['resolveBackground']

  beforeEach(async () => {
    vi.resetModules()
    ;({ queryBackground, stopBackgroundQuery } = await import('../../src/dev/tui/background'))
    ;({ resolveBackground } = await import('../../src/utils/terminal-theme'))
  })

  /** Ask, answering with `reply` once the query has been written. */
  function ask(reply: string | undefined, options: { env?: NodeJS.ProcessEnv, timeout?: number } = {}) {
    const terminal = stubStdin()
    const written: string[] = []
    const answer = queryBackground({
      write: (chunk) => {
        written.push(chunk)
        if (reply !== undefined) {
          terminal.emit(reply)
        }
      },
      stdin: terminal.stdin,
      stdout: { isTTY: true },
      env: { TERM: 'xterm-256color', ...options.env },
      timeout: options.timeout ?? 20,
      ci: false,
      test: false,
    })
    return { answer, terminal, written }
  }

  it('reads a light background from the colour the terminal reports', async () => {
    const { answer, written } = ask('\u001B]11;rgb:ffff/ffff/ffff\u0007')

    await expect(answer).resolves.toBe('light')
    expect(written).toEqual(['\u001B]11;?\u0007'])
    expect(resolveBackground({})).toBe('light')
  })

  it('reads a dark background, in whatever precision the reply uses', async () => {
    await expect(ask('\u001B]11;rgb:1c/1c/1c\u001B\\').answer).resolves.toBe('dark')
  })

  it('calls a light grey light', async () => {
    await expect(ask('\u001B]11;rgb:b0b0/b0b0/b0b0\u0007').answer).resolves.toBe('light')
  })

  it('calls a dark grey dark', async () => {
    await expect(ask('\u001B]11;rgb:4040/4040/4040\u0007').answer).resolves.toBe('dark')
  })

  it('gives up on a terminal that never answers, and leaves stdin as it was', async () => {
    const { answer, terminal } = ask(undefined)

    await expect(answer).resolves.toBe('unknown')
    expect(terminal.calls.raw).toEqual([true, false])
    expect(resolveBackground({})).toBe('unknown')
  })

  it('gives stdin back the moment something else needs it', async () => {
    const terminal = stubStdin()
    const answer = queryBackground({
      write: () => {},
      stdin: terminal.stdin,
      stdout: { isTTY: true },
      env: { TERM: 'xterm-256color' },
      timeout: 10_000,
      ci: false,
      test: false,
    })
    expect(terminal.calls.raw).toEqual([true])

    stopBackgroundQuery()

    // Synchronously, because the caller claims stdin in this same tick.
    expect(terminal.calls.raw).toEqual([true, false])
    await expect(answer).resolves.toBe('unknown')
  })

  it('leaves raw mode alone when it found stdin already in it', async () => {
    const terminal = stubStdin()
    terminal.stdin.isRaw = true
    const answer = queryBackground({
      write: () => {},
      stdin: terminal.stdin,
      stdout: { isTTY: true },
      env: { TERM: 'xterm-256color' },
      timeout: 10,
      ci: false,
      test: false,
    })

    await expect(answer).resolves.toBe('unknown')
    expect(terminal.calls.raw).toEqual([true])
  })

  it('asks once, however many times it is called', async () => {
    const { answer, written } = ask('\u001B]11;rgb:0000/0000/0000\u0007')
    await expect(answer).resolves.toBe('dark')

    const again = ask('\u001B]11;rgb:ffff/ffff/ffff\u0007')
    await expect(again.answer).resolves.toBe('dark')
    expect(again.written).toEqual([])
    expect(written).toHaveLength(1)
  })

  it('hands back keys pressed while the terminal was thinking', async () => {
    const terminal = stubStdin()
    const answer = queryBackground({
      write: () => {
        terminal.emit('r')
        terminal.emit('\u001B]11;rgb:0000/0000/0000\u0007')
      },
      stdin: terminal.stdin,
      stdout: { isTTY: true },
      env: { TERM: 'xterm-256color' },
      timeout: 20,
      ci: false,
      test: false,
    })

    await expect(answer).resolves.toBe('dark')
    expect(terminal.calls.unshifted.join('')).toBe('r')
  })

  it('passes on a Ctrl-C that raw mode would otherwise have eaten', async () => {
    const signal = vi.fn()
    process.once('SIGINT', signal)
    try {
      await expect(ask('\u0003').answer).resolves.toBe('unknown')
      expect(signal).toHaveBeenCalled()
    }
    finally {
      process.off('SIGINT', signal)
    }
  })

  it.each([
    ['a request for no colour', { NO_COLOR: '1' }],
    ['a terminal that cannot answer', { TERM: 'dumb' }],
    ['screen, which never passes the reply back', { TERM: 'screen.xterm-256color' }],
  ])('does not ask %s', async (_case, env) => {
    const { answer, written } = ask('\u001B]11;rgb:ffff/ffff/ffff\u0007', { env })

    await expect(answer).resolves.toBe('unknown')
    expect(written).toEqual([])
  })

  it('asks inside tmux, which answers for the terminal', async () => {
    const { answer } = ask('\u001B]11;rgb:ffff/ffff/ffff\u0007', { env: { TERM: 'screen-256color', TMUX: '/tmp/tmux-1/default' } })

    await expect(answer).resolves.toBe('light')
  })

  it('takes an explicit setting over anything the terminal would say', async () => {
    const { answer, written } = ask('\u001B]11;rgb:ffff/ffff/ffff\u0007', { env: { NUXT_TERM_THEME: 'dark' } })

    await expect(answer).resolves.toBe('dark')
    expect(written).toEqual([])
  })
})
