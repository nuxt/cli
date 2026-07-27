import type { DevRestartReason } from '../../src/dev/reason'

import { EventEmitter } from 'node:events'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRestartHook } from '../../src/dev'

const ERROR_EVENTS = ['uncaughtException', 'unhandledRejection'] as const

function errorListeners() {
  return ERROR_EVENTS.flatMap(event => process.listeners(event as 'uncaughtException'))
}

describe('restart hook', () => {
  const installed = new Set<(...args: any[]) => void>()

  afterEach(() => {
    for (const listener of installed) {
      for (const event of ERROR_EVENTS) {
        process.off(event, listener as never)
      }
    }
    installed.clear()
  })

  /** Arm the hook, remembering its process listeners so they can be removed. */
  function arm(source: EventEmitter, callback: (reason?: DevRestartReason) => void, armRestart = createRestartHook(source)) {
    const before = new Set(errorListeners())
    armRestart(callback)
    for (const listener of errorListeners()) {
      if (!before.has(listener)) {
        installed.add(listener)
      }
    }
    return armRestart
  }

  it('should call the restart callback once', () => {
    const source = new EventEmitter()
    const callback = vi.fn()
    arm(source, callback)

    source.emit('restart', { type: 'shortcut' })
    source.emit('restart', { type: 'shortcut' })

    expect(callback).toHaveBeenCalledExactlyOnceWith({ type: 'shortcut' })
  })

  it('should restart on an error that is not a broken pipe', () => {
    const source = new EventEmitter()
    const callback = vi.fn()
    arm(source, callback)

    const [onError] = [...installed]
    onError!(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    expect(callback).not.toHaveBeenCalled()

    onError!(new Error('boom'))
    expect(callback).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining('boom') })
  })

  it('should not stack listeners when re-armed', () => {
    const source = new EventEmitter()
    const first = vi.fn()
    const second = vi.fn()
    const armRestart = arm(source, first)

    source.emit('restart', { type: 'shortcut' })
    const afterRestart = errorListeners().length
    arm(source, second, armRestart)

    expect(errorListeners().length).toBe(afterRestart + ERROR_EVENTS.length)
    expect(source.listenerCount('restart')).toBe(1)

    source.emit('restart', { type: 'config' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledExactlyOnceWith({ type: 'config' })
  })

  it('should not stack listeners when re-armed after an error-triggered restart', () => {
    const source = new EventEmitter()
    const armRestart = arm(source, vi.fn())

    for (let attempt = 0; attempt < 3; attempt++) {
      const [onError] = [...installed]
      onError!(new Error('boom'))
      arm(source, vi.fn(), armRestart)
      expect(source.listenerCount('restart')).toBe(1)
    }
  })

  it('should replace the callback without re-arming while still armed', () => {
    const source = new EventEmitter()
    const first = vi.fn()
    const second = vi.fn()
    const armRestart = arm(source, first)
    const armed = errorListeners().length

    arm(source, second, armRestart)

    expect(errorListeners().length).toBe(armed)
    source.emit('restart')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
