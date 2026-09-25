import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'
import { describe, expect, it } from 'vitest'
import { withProgress } from '../../src/dev/loading-page'

function snapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    status: 'loading',
    phase: 'config',
    message: 'Loading Nuxt config',
    index: 0,
    total: 6,
    progress: 0.1,
    elapsed: 0,
    phaseElapsed: 0,
    reload: false,
    serving: false,
    timings: [],
    ...overrides,
  }
}

/** Roughly what `@nuxt/schema` renders, including the marker its own poll looks for. */
const NUXT_TEMPLATE = `<!DOCTYPE html><html><head><title>Loading | Nuxt</title></head>`
  + `<body><div class="nuxt-loader-bar"></div><script>fetch(location.href).then(r=>r.text().includes("__NUXT_LOADING__"))</script></body></html>`

describe('withProgress', () => {
  it('should leave the page it is given intact', () => {
    const html = withProgress(NUXT_TEMPLATE, snapshot())

    expect(html).toContain('<div class="nuxt-loader-bar"></div>')
    expect(html).toContain('<title>Loading | Nuxt</title>')
    expect(html.indexOf('</body>')).toBeGreaterThan(html.indexOf('nuxt-dev-phase'))
  })

  it('should keep the marker the page polls for, so it does not reload itself', () => {
    expect(withProgress(NUXT_TEMPLATE, snapshot())).toContain('__NUXT_LOADING__')
  })

  it('should hand the client its stream and the time already elapsed', () => {
    const html = withProgress(NUXT_TEMPLATE, snapshot({ elapsed: 1200 }))

    expect(html).toContain('"progressPath":"/__nuxt_dev__/progress"')
    expect(html).toContain('"elapsed":1200')
  })

  it('should append to a page with no body element', () => {
    expect(withProgress('<h2>Loading</h2>', snapshot())).toContain('nuxt-dev-phase')
  })
})
