import { Buffer } from 'node:buffer'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { attachKeys } from '../../src/dev/tui/keys'
import { filterTerminalReplies } from '../../src/dev/tui/terminal-replies'

describe('panel keys', () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    for (const restore of restores.splice(0)) {
      restore()
    }
  })

  function attach() {
    const stdin = new PassThrough() as unknown as typeof process.stdin
    Object.assign(stdin, { isTTY: true, isRaw: false, setRawMode: (raw: boolean) => Object.assign(stdin, { isRaw: raw }) })
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    restores.push(() => Object.defineProperty(process, 'stdin', original))

    const keys: Array<string | undefined> = []
    const detach = attachKeys(key => keys.push(key.name))
    restores.push(detach)

    return {
      keys,
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
    await type('\\\\')
    await type('o')

    expect(keys).toEqual(['o'])
  })

  it('should give the keyboard back when a reply is never terminated', async () => {
    const { keys, type } = attach()

    await type('\u001B]11;rgb:1e1e')
    await new Promise(resolve => setTimeout(resolve, 250))
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
