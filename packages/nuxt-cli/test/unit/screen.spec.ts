import { beforeEach, describe, expect, it, vi } from 'vitest'

type Screen = typeof import('../../src/utils/screen')

describe('screen hold', () => {
  let holdScreen: Screen['holdScreen']
  let onScreenHeld: Screen['onScreenHeld']
  let isScreenHeld: Screen['isScreenHeld']

  beforeEach(async () => {
    vi.resetModules()
    ;({ holdScreen, onScreenHeld, isScreenHeld } = await import('../../src/utils/screen'))
  })

  it('should say whether a question is on screen', () => {
    expect(isScreenHeld()).toBe(false)

    const release = holdScreen()
    expect(isScreenHeld()).toBe(true)

    release()
    expect(isScreenHeld()).toBe(false)
  })

  it('should tell a listener when a question takes the screen and gives it back', () => {
    const seen: boolean[] = []
    onScreenHeld(held => seen.push(held))

    const release = holdScreen()
    release()
    release()

    expect(seen).toEqual([true, false])
  })

  it('should stay held until every nested question is answered', () => {
    const seen: boolean[] = []
    onScreenHeld(held => seen.push(held))

    const releaseOuter = holdScreen()
    const releaseInner = holdScreen()
    releaseOuter()
    expect(seen).toEqual([true])

    releaseInner()
    expect(seen).toEqual([true, false])
  })

  it('should tell a listener added during a question that the screen is taken', () => {
    const release = holdScreen()
    const seen: boolean[] = []
    onScreenHeld(held => seen.push(held))
    release()

    expect(seen).toEqual([true, false])
  })
})
