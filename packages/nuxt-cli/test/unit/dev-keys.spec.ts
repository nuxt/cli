import type { MouseReport } from '../../src/dev/tui/terminal-replies'

import { Buffer } from 'node:buffer'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachKeys } from '../../src/dev/tui/keys'
import { filterTerminalReplies } from '../../src/dev/tui/terminal-replies'

describe('panel keys', () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    // Reverse: the second `attach` saved the descriptor the first installed.
    for (const restore of restores.splice(0).reverse()) {
      restore()
    }
  })

  function attach(options?: { ignoreBufferedInput?: boolean }) {
    const stdin = new PassThrough() as unknown as typeof process.stdin
    Object.assign(stdin, { isTTY: true, isRaw: false, setRawMode: (raw: boolean) => Object.assign(stdin, { isRaw: raw }) })
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    restores.push(() => Object.defineProperty(process, 'stdin', original))

    const keys: Array<string | undefined> = []
    const mouse: MouseReport[] = []
    const detach = attachKeys(key => keys.push(key.name), { ...options, onMouse: report => mouse.push(report) })
    restores.push(detach)

    return {
      keys,
      mouse,
      type: async (text: string) => {
        stdin.write(text)
        await new Promise(resolve => setImmediate(resolve))
      },
    }
  }

  it('should not read the answer to the background query as keys', async () => {
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e/1e1e/1e1e\u0007')

    expect(keys).toEqual([])
  })

  it('should keep dropping a reply that arrives in pieces', async () => {
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e/')
    await type('1e1e/1e1e\u0007')

    expect(keys).toEqual([])
  })

  it('should read what is typed after a reply', async () => {
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e/1e1e/1e1e\u0007')
    await type('o')

    expect(keys).toEqual(['o'])
  })

  it('should read the next key straight after a cursor position report', async () => {
    const { keys, type } = attach()

    await type('\u001B[12;34R')
    await type('o')

    expect(keys).toEqual(['o'])
  })

  it('should drop a csi report whose final byte arrives in the next chunk', async () => {
    const { keys, type } = attach()

    await type('\u001B[12;')
    await type('34R')
    await type('o')

    expect(keys).toEqual(['o'])
  })

  it('should read the next key when a string terminator is split', async () => {
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e/1e1e/1e1e\u001B')
    await type('\\')
    await type('o')

    expect(keys).toEqual(['o'])
  })

  it('should read a key that arrives in the same chunk as a csi report', async () => {
    const { keys, type } = attach()

    await type('\u001B[12;34Ro')

    expect(keys).toEqual(['o'])
  })

  it('should read a key that arrives in the same chunk as a string reply', async () => {
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e/1e1e/1e1e\u0007o')

    expect(keys).toEqual(['o'])
  })

  it('should give the keyboard back when a reply is never terminated', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    restores.push(() => vi.useRealTimers())
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e')
    vi.advanceTimersByTime(250)
    await type('o')

    expect(keys).toEqual(['o'])
  })

  it('should pass on keys that are escape sequences of their own', async () => {
    const { keys, type } = attach()

    await type('\u001B[A')
    await type('\u001BOP')
    await type('q')

    expect(keys).toEqual(['up', 'f1', 'q'])
  })

  it('should read a mouse report as the mouse, not as keys', async () => {
    const { keys, mouse, type } = attach()

    await type('\u001B[<0;12;5M')
    await type('\u001B[<0;12;5m')
    await type('o')

    expect(keys).toEqual(['o'])
    expect(mouse).toEqual([
      { button: 0, pressed: true, row: 4, column: 11 },
      { button: 0, pressed: false, row: 4, column: 11 },
    ])
  })

  it('should read every report of a wheel burst, and the key after it', async () => {
    const { keys, mouse, type } = attach()

    await type('\u001B[<64;1;1M\u001B[<64;1;1Mo')
    // Each report hands the rest back a tick later.
    await new Promise(resolve => setImmediate(resolve))

    expect(keys).toEqual(['o'])
    expect(mouse).toHaveLength(2)
  })

  it('should read a mouse report that arrives in pieces', async () => {
    const { keys, mouse, type } = attach()

    await type('\u001B[<65;1')
    await type(';1M')
    await type('o')

    expect(keys).toEqual(['o'])
    expect(mouse).toHaveLength(1)
  })

  it('should drop input buffered before it took stdin, when asked to', async () => {
    const buffered = attach({ ignoreBufferedInput: true })
    await buffered.type('ooo')
    expect(buffered.keys).toEqual([])

    const live = attach()
    await live.type('ooo')
    expect(live.keys).toEqual(['o', 'o', 'o'])
  })
})

describe('terminal replies', () => {
  function feed(...chunks: string[]): boolean[] {
    const stdin = new PassThrough()
    const filter = filterTerminalReplies(stdin)
    const states = chunks.map((chunk) => {
      stdin.emit('data', Buffer.from(chunk, 'latin1'))
      return filter.isReplying()
    })
    filter.stop()
    return states
  }

  it('should hold a csi report that is still arriving', () => {
    expect(feed('\u001B[12;', '34R')).toEqual([true, true])
  })

  it('should hold a string reply until its terminator', () => {
    expect(feed('\u001B]11;rgb:1e1e', '/1e1e/1e1e\u0007')).toEqual([true, true])
  })

  it('should not hold a lone escape, which is also a key', () => {
    expect(feed('\u001B')).toEqual([false])
  })

  it('should not hold keys that are escape sequences of their own', () => {
    expect(feed('\u001B[A', '\u001BOP', 'q')).toEqual([false, false, false])
  })

  it('should give up on a tail that never becomes a reply', () => {
    expect(feed(`\u001B[${'1'.repeat(70)}`)).toEqual([false])
  })
})
