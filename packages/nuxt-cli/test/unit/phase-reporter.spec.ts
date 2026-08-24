import type { PhaseReporter } from '../../src/utils/phase-reporter'
import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { blankLineBefore, observeOutput, trackOutputSpacing } from '../../src/utils/stdout'
import { render, screen } from '../utils/terminal'

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  isCI: false,
}))

process.env.FORCE_COLOR = '3'

const { createPhaseReporter, formatSummary, isAnimationSupported } = await import('../../src/utils/phase-reporter')

function snapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    status: 'loading',
    phase: 'config',
    message: 'Loading Nuxt config',
    index: 0,
    total: 6,
    progress: 0,
    elapsed: 0,
    reload: false,
    serving: false,
    timings: [],
    ...overrides,
  }
}

describe('phase reporter', () => {
  const reporters: PhaseReporter[] = []

  afterEach(() => {
    reporters.splice(0).forEach(reporter => reporter.stop())
    vi.restoreAllMocks()
  })

  /** The transient line renders elapsed time from the wall clock, which would otherwise tick between the update and the assertion. */
  function freezeClock(): void {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
  }

  function reporter(animated: boolean): PhaseReporter {
    const instance = createPhaseReporter({ animated })
    reporters.push(instance)
    return instance
  }

  it('should keep the progress line in place while loading', async () => {
    freezeClock()
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot())
      startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))
    })

    expect(screen(renderer)).toMatch(/^. Bundling app 0ms$/)
  })

  it('should collapse to a summary with a phase breakdown once ready', async () => {
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot())
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        progress: 1,
        serving: true,
        elapsed: 2400,
        timings: [
          { phase: 'config', message: 'Loading Nuxt config', duration: 320 },
          { phase: 'bundle', message: 'Bundling app', duration: 940 },
        ],
      }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ◆  Ready in 2.4s
      │  config 320ms · bundle 940ms"
    `)
  })

  it('should log each phase sequentially when the output is not a terminal', async () => {
    const renderer = await render(() => {
      const startup = reporter(false)
      startup.update(snapshot())
      startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))
      startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Loading Nuxt config
      │
      ●  Bundling app"
    `)
  })

  it('should repeat a long phase when there is no animated line', async () => {
    const renderer = await render(async ({ waitForOutput }) => {
      const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
      reporters.push(startup)
      startup.update(snapshot({ phase: 'server', message: 'Building Nitro server', index: 5, elapsed: 4000 }))
      await waitForOutput(/Building Nitro server[\s\S]*Building Nitro server/)
    })

    expect(screen(renderer)).toContain('Building Nitro server')
  })

  it('should name what a long phase is doing, no more often than its heartbeat', async () => {
    const renderer = await render(() => {
      const startup = createPhaseReporter({ animated: false, heartbeat: 60_000 })
      reporters.push(startup)
      startup.update(snapshot({ phase: 'server', message: 'Building Nitro server', index: 5 }))
      startup.update(snapshot({ phase: 'server', message: 'Bundling Nitro server', index: 5 }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Building Nitro server"
    `)
  })

  it('should leave foreign output intact', async () => {
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot())
      process.stdout.write('Nuxt 4.5.1\n')
      startup.stop()
    })

    expect(screen(renderer)).toBe('Nuxt 4.5.1')
  })

  it('should leave the output spacing tracker installed once it is done', async () => {
    await render(() => {
      const startup = reporter(true)
      trackOutputSpacing()
      observeOutput('mid-line')
      startup.update(snapshot())
      startup.stop()
      process.stdout.write('Nuxt 4.5.1\n')
    })

    expect(blankLineBefore()).toBe('\n')
  })

  it('should not claim a startup is over while the first request is compiling', async () => {
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot())
      startup.update(snapshot({ status: 'ready', phase: 'ready', message: 'Compiling the first request', index: 6, elapsed: 2400 }))
      startup.update(snapshot({ status: 'ready', phase: 'ready', message: 'Ready', index: 6, serving: true, elapsed: 8100 }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ◆  Ready in 2.4s · compiling the first request
      │
      ◆  Serving in 8.1s"
    `)
  })

  it('should say nothing more after a build error, which is reported separately', async () => {
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot())
      startup.update(snapshot({ status: 'error', message: 'boom' }))
    })

    expect(screen(renderer)).toBe('')
  })

  it('should describe a reload rather than a first start', () => {
    expect(formatSummary(snapshot({ status: 'ready', reload: true, serving: true, elapsed: 900 }))).toBe('Reloaded in 900ms')
  })

  // `nuxt dev` runs under `consola.wrapAll()`, which moves the real `write` to
  // `__write` and turns every chunk into a trimmed line of its own.
  function wrapStdoutAsConsolaDoes(): () => void {
    const stream = process.stdout as typeof process.stdout & { __write?: typeof process.stdout.write }
    const original = stream.write
    stream.__write = original
    stream.write = ((data: unknown) => {
      const write = stream.__write!
      return write.call(stream, `${String(data).trim()}\n`)
    }) as typeof process.stdout.write
    return () => {
      stream.write = original
      delete stream.__write
    }
  }

  it('should keep the progress line in place under the dev console wrapper', async () => {
    freezeClock()
    const renderer = await render(async () => {
      const restore = wrapStdoutAsConsolaDoes()
      try {
        const startup = reporter(true)
        startup.update(snapshot())
        startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))
      }
      finally {
        restore()
      }
    })

    expect(screen(renderer)).toMatch(/^. Bundling app 0ms$/)
  })

  it('should clear the line before output that consola writes through `__write`', async () => {
    const renderer = await render(async () => {
      const restore = wrapStdoutAsConsolaDoes()
      try {
        const startup = reporter(true)
        startup.update(snapshot())
        // what consola's own reporter does, bypassing `process.stdout.write`
        const stream = process.stdout as typeof process.stdout & { __write?: typeof process.stdout.write }
        stream.__write!.call(process.stdout, 'Nuxt 4.5.2\n')
        startup.stop()
      }
      finally {
        restore()
      }
    })

    expect(screen(renderer)).toBe('Nuxt 4.5.2')
  })

  it('should draw the line only where a terminal can redraw it', () => {
    expect(isAnimationSupported({ isTTY: true } as NodeJS.WriteStream)).toBe(true)
    expect(isAnimationSupported({ isTTY: false } as NodeJS.WriteStream)).toBe(false)

    process.env.NO_COLOR = '1'
    expect(isAnimationSupported({ isTTY: true } as NodeJS.WriteStream)).toBe(false)
    delete process.env.NO_COLOR
  })
})
