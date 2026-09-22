import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { paintFirstFrame } from '../../src/dev/tui/first-frame'
import { beginDevUI } from '../../src/dev/tui/session'

/** Pretend stdout and stdin are a terminal of a usable size. */
function withTerminal<T>(run: (chunks: string[]) => T, terminal = true): T {
  const chunks: string[] = []
  const saved = [
    ['stdout', 'isTTY', Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')],
    ['stdout', 'columns', Object.getOwnPropertyDescriptor(process.stdout, 'columns')],
    ['stdout', 'rows', Object.getOwnPropertyDescriptor(process.stdout, 'rows')],
    ['stdin', 'isTTY', Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')],
    ['stdin', 'setRawMode', Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode')],
  ] as const
  Object.defineProperty(process.stdout, 'isTTY', { value: terminal, configurable: true })
  Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true })
  Object.defineProperty(process.stdout, 'rows', { value: 30, configurable: true })
  Object.defineProperty(process.stdin, 'isTTY', { value: terminal, configurable: true })
  Object.defineProperty(process.stdin, 'setRawMode', { value: () => process.stdin, configurable: true })
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  })
  try {
    return run(chunks)
  }
  finally {
    write.mockRestore()
    for (const [stream, key, descriptor] of saved) {
      if (descriptor) {
        Object.defineProperty(process[stream], key, descriptor)
      }
    }
  }
}

describe('first panel frame', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('should paint a starting panel', () => {
    withTerminal((chunks) => {
      const start = paintFirstFrame({ version: '4.5.2', ci: false, test: false })

      expect(start).toBeDefined()
      expect(chunks.join('')).toContain('4.5.2')
      start!.surface.close({ keep: false })
    })
  })

  it('should paint nothing where the panel is not supported', () => {
    withTerminal((chunks) => {
      expect(paintFirstFrame({ version: '4.5.2', ci: false, test: false })).toBeUndefined()
      expect(chunks.join('')).toBe('')
    }, false)
  })

  it('should repaint itself when the window is resized before the session exists', () => {
    withTerminal((chunks) => {
      const start = paintFirstFrame({ version: '4.5.2', ci: false, test: false })!
      chunks.length = 0

      Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
      process.stdout.emit('resize')

      // An erase with nothing after it would leave the panel off the screen.
      expect(chunks.join('')).toContain('4.5.2')
      start.surface.close({ keep: false })
    })
  })

  it('should let the session adopt the frame already on screen', () => {
    withTerminal(() => {
      const start = paintFirstFrame({ version: '4.5.2', ci: false, test: false })!
      const session = beginDevUI({ version: '4.5.2', ci: false, test: false, start })

      expect(session).toBeDefined()
      expect(session!.surface).toBe(start.surface)
      session!.teardown()
    })
  })
})
