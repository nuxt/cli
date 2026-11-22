import type { ServerResponse } from 'node:http'

import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { onResponseClose } from '../../../src/dev/response-close'

describe('onResponseClose', () => {
  it('should run every callback in order through one listener', () => {
    const res = new EventEmitter() as ServerResponse
    const ran: number[] = []

    for (const id of [1, 2, 3]) {
      onResponseClose(res, () => ran.push(id))
    }

    expect(res.listenerCount('close')).toBe(1)
    res.emit('close')
    expect(ran).toEqual([1, 2, 3])
  })

  it('should keep the callbacks of different responses apart', () => {
    const first = new EventEmitter() as ServerResponse
    const second = new EventEmitter() as ServerResponse
    const ran: string[] = []
    onResponseClose(first, () => ran.push('first'))
    onResponseClose(second, () => ran.push('second'))

    second.emit('close')

    expect(ran).toEqual(['second'])
  })
})
