import { describe, expect, it } from 'vitest'

import { ActionableError, asActionableError, isRemotePeerError, isReportedError } from '../../src/utils/errors'

const REPORTED = Symbol.for('nuxt.diagnostic.reported')

function markReported(error: object): void {
  Object.defineProperty(error, REPORTED, { value: true })
}

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
    expect(actionable.message).toBe('[NUXT_B8017] The module `@nuxt/image` could not be loaded. It may not be installed.\nRun `npm install @nuxt/image` to install it.')
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

  it('should skip a diagnostic Nuxt has already reported', () => {
    const error = Object.assign(new Error('2 routes failed to prerender: `/broken` (500), `/missing` (404).'), {
      code: 'NUXT_B1024',
      fix: 'Fix the errors logged above, skip the routes with `prerender.ignore`.',
      docs: 'https://nuxt.com/docs/getting-started/deployment',
    })
    markReported(error)

    expect(asActionableError(error)).toBeUndefined()
  })

  it('should skip a bundler wrapper whose diagnostics are all already reported', () => {
    const diagnostic = Object.assign(new Error('Build failed with 1 error: boom'), {
      name: 'NUXT_B7021',
      code: 'PLUGIN_ERROR',
      pluginCode: 'NUXT_B7021',
    })
    markReported(diagnostic)
    const wrapper = Object.assign(new Error('Build failed with 1 error: boom'), {
      code: 'PLUGIN_ERROR',
      errors: [diagnostic],
    })

    expect(isReportedError(wrapper)).toBe(true)
    expect(asActionableError(wrapper)).toBeUndefined()
  })

  it('should not skip a wrapper unless every wrapped diagnostic was reported', () => {
    const diagnostic = Object.assign(new Error('boom'), { name: 'NUXT_B7021' })
    markReported(diagnostic)
    const partial = Object.assign(new Error('Build failed with 2 errors'), {
      code: 'PLUGIN_ERROR',
      errors: [
        diagnostic,
        new Error('unreported'),
      ],
    })
    const empty = Object.assign(new Error('Build failed'), { errors: [] })

    expect(isReportedError(partial)).toBe(false)
    expect(asActionableError(partial)).toBe(partial)
    expect(isReportedError(empty)).toBe(false)
    expect(asActionableError(empty)).toBe(empty)
  })

  it('should prefix an unmarked diagnostic with its code', () => {
    const error = Object.assign(new Error('2 routes failed to prerender: `/broken` (500), `/missing` (404).'), {
      name: 'NUXT_B1024',
      fix: 'Fix the errors logged above, skip the routes with `prerender.ignore`.',
      docs: 'https://nuxt.com/docs/getting-started/deployment',
    })

    const actionable = asActionableError(error) as Error

    expect(actionable).toBeInstanceOf(ActionableError)
    expect(actionable.message).toBe(
      '[NUXT_B1024] 2 routes failed to prerender: `/broken` (500), `/missing` (404).\n'
      + 'Fix the errors logged above, skip the routes with `prerender.ignore`.\n'
      + 'See https://nuxt.com/docs/getting-started/deployment',
    )
  })

  it('should prefix a diagnostic whose code was moved to pluginCode', () => {
    const error = Object.assign(new Error('Transform failed'), {
      code: 'PLUGIN_ERROR',
      pluginCode: 'NUXT_B7021',
    })

    expect((asActionableError(error) as Error).message).toBe('[NUXT_B7021] Transform failed')
  })

  it('should prefix a code-only diagnostic without a remedy', () => {
    const error = Object.assign(new Error('2 routes failed to prerender.'), { name: 'NUXT_B1024' })

    expect((asActionableError(error) as Error).message).toBe('[NUXT_B1024] 2 routes failed to prerender.')
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
