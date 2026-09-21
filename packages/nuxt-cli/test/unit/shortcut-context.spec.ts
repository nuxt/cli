import { describe, expect, it, vi } from 'vitest'

import { deferShortcutContext } from '../../src/dev/shortcut-context'

function server(overrides: Record<string, unknown> = {}) {
  const started = {
    listener: { url: 'http://localhost:3000/' },
    close: vi.fn(async () => {}),
    onReady: vi.fn(),
    ...overrides,
  }
  return started as typeof started & Parameters<ReturnType<typeof deferShortcutContext>['attach']>[0]
}

describe('deferShortcutContext', () => {
  it('should publish the server once it is attached', () => {
    const { context, attach } = deferShortcutContext()
    expect(context.listener).toBeUndefined()

    attach(server())

    expect(context.listener).toEqual({ url: 'http://localhost:3000/' })
  })

  it('should forward ready callbacks registered before there was a server', () => {
    const { context, attach } = deferShortcutContext()
    const ready = vi.fn()
    context.onReady(ready)

    const started = server()
    attach(started)

    expect(started.onReady).toHaveBeenCalledWith(ready)
  })

  it('should close a server attached after a shutdown had already begun', async () => {
    const { context, attach } = deferShortcutContext()

    const closed = context.close()
    const started = server()
    attach(started)
    await closed
    await context.close()

    expect(started.close).toHaveBeenCalledTimes(1)
    expect(context.listener).toBeUndefined()
  })

  it('should close an attached server once, however often it is asked', async () => {
    const { context, attach } = deferShortcutContext()
    const started = server()
    attach(started)

    await Promise.all([context.close(), context.close()])

    expect(started.close).toHaveBeenCalledTimes(1)
  })
})
