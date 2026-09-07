import { describe, expect, it } from 'vitest'

import { ActionableError, asActionableError, isRemotePeerError } from '../../src/utils/errors'

describe('actionableError', () => {
  it('should print its advice instead of a stack trace', () => {
    const error = new ActionableError('Run `pnpm install` first.')

    expect(error.stack).toBe('Run `pnpm install` first.')
    expect(error.message).toBe('Run `pnpm install` first.')
  })
})

describe('asActionableError', () => {
  it('should lead with the remedy a nuxt error carries instead of its frames', () => {
    const error = Object.assign(new Error('The module `@nuxt/image` could not be loaded. It may not be installed.'), {
      code: 'NUXT_B8017',
      fix: 'Run `npm install @nuxt/image` to install it.',
    })

    const actionable = asActionableError(error) as Error

    expect(actionable).toBeInstanceOf(ActionableError)
    expect(actionable.stack).toBe(actionable.message)
    expect(actionable.message).toBe('The module `@nuxt/image` could not be loaded. It may not be installed.\nRun `npm install @nuxt/image` to install it.')
    expect(actionable.stack).not.toContain('    at ')
  })

  it('should point at the docs a nuxt error references', () => {
    const error = Object.assign(new Error('Something is misconfigured.'), {
      fix: 'Set `compatibilityDate`.',
      docs: 'https://nuxt.com/docs',
    })

    expect((asActionableError(error) as Error).message).toBe('Something is misconfigured.\nSet `compatibilityDate`.\nSee https://nuxt.com/docs')
  })

  it('should leave an untagged error alone, since its stack is all there is', () => {
    const error = new Error('boom')

    const blank = Object.assign(new Error('boom'), { fix: '  ' })

    expect(asActionableError(error)).toBe(error)
    expect(asActionableError(blank)).toBe(blank)
    expect(asActionableError('not an error')).toBe('not an error')
  })
})

describe('isRemotePeerError', () => {
  it('should detect errors from the other end of a connection', () => {
    expect(isRemotePeerError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('aborted'), { code: 'ECONNABORTED' }))).toBe(true)
    expect(isRemotePeerError(Object.assign(new Error('premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }))).toBe(true)
  })

  it('should ignore other errors', () => {
    expect(isRemotePeerError(new Error('boom'))).toBe(false)
    expect(isRemotePeerError(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(false)
    expect(isRemotePeerError(undefined)).toBe(false)
  })
})
