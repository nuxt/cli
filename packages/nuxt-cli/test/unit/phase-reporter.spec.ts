import type { PhaseReporter } from '../../src/utils/phase-reporter'
import type { ProgressSnapshot } from '../../src/utils/progress-snapshot'

import { stripVTControlCharacters, styleText } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { blankLineBefore, observeOutput, trackOutputSpacing } from '../../src/utils/stdout'
import { render, screen } from '../utils/terminal'

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  isCI: false,
}))

process.env.FORCE_COLOR = '3'

const { createPhaseReporter, formatMeter, formatPhaseTable, formatSummary, isAnimationSupported } = await import('../../src/utils/phase-reporter')
const { holdScreen } = await import('../../src/utils/screen')

function stubUnicode(supported: boolean): void {
  vi.stubEnv('LC_ALL', supported ? 'en_GB.UTF-8' : 'C')
  for (const name of [
    'WT_SESSION',
    'TERMINUS_SUBLIME',
    'ConEmuTask',
    'TERM_PROGRAM',
  ]) {
    vi.stubEnv(name, '')
  }
  if (supported) {
    vi.stubEnv('WT_SESSION', '1')
  }
}

function snapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    status: 'loading',
    phase: 'config',
    message: 'Loading Nuxt config',
    index: 0,
    total: 6,
    progress: 0,
    elapsed: 0,
    phaseElapsed: 0,
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

    expect(screen(renderer)).toMatch(/^. Bundling app 0\.0ms$/)
  })

  it('should show how long the phase has taken alongside the total', async () => {
    freezeClock()
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot({
        phase: 'types',
        message: 'Generating types',
        index: 3,
        elapsed: 41_000,
        phaseElapsed: 33_000,
      }))
    })

    expect(screen(renderer)).toMatch(/^. Generating types 33\.0s \u00B7 total 41\.0s$/)
  })

  it('should take its line down while a question is on screen, and put it back after', () => {
    vi.useFakeTimers()
    freezeClock()
    let release = () => {}
    try {
      const chunks: string[] = []
      const stream = {
        isTTY: true,
        columns: 100,
        write: (chunk: string) => {
          chunks.push(chunk)
          return true
        },
      } as unknown as NodeJS.WriteStream
      const startup = createPhaseReporter({ animated: true, stream })
      reporters.push(startup)
      startup.update(snapshot())
      startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))

      const painted = chunks.length
      release = holdScreen()
      expect(chunks.slice(painted)).toEqual(['\r\u001B[2K', '\u001B[?25h'])

      startup.update(snapshot({ phase: 'server', message: 'Building server', index: 5 }))
      vi.advanceTimersByTime(240)
      expect(chunks.length).toBe(painted + 2)

      release()
      expect(chunks.slice(painted + 2)).toEqual([
        '\u001B[?25l',
        expect.stringContaining('Building server'),
      ])
      vi.advanceTimersByTime(80)
      expect(chunks.length).toBe(painted + 5)
    }
    finally {
      release()
      vi.useRealTimers()
    }
  })

  it('should say nothing while a question is on screen, and give the latest line after', () => {
    vi.useFakeTimers()
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(stripVTControlCharacters(String(chunk)))
      return true
    })
    let release = () => {}
    try {
      const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
      reporters.push(startup)
      startup.update(snapshot({ phase: 'types', message: 'Generating types', index: 3 }))
      written.length = 0

      release = holdScreen()
      startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))
      startup.update(snapshot({ phase: 'server', message: 'Building server', index: 5 }))
      vi.advanceTimersByTime(100)
      expect(written).toEqual([])

      release()
      expect(written.join('')).toContain('Building server')
      expect(written.join('')).not.toContain('Bundling app')
    }
    finally {
      release()
      vi.useRealTimers()
    }
  })

  it('should not give a startup line after the summary it was overtaken by', () => {
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(stripVTControlCharacters(String(chunk)))
      return true
    })
    let release = () => {}
    try {
      const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
      reporters.push(startup)
      startup.update(snapshot({ phase: 'types', message: 'Generating types', index: 3 }))

      release = holdScreen()
      startup.update(snapshot({ phase: 'server', message: 'Building server', index: 5 }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }))
      written.length = 0

      release()
      expect(written.join('')).not.toContain('Building server')
    }
    finally {
      release()
    }
  })

  it('should leave an idle line down once a question is answered', () => {
    vi.useFakeTimers()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const chunks: string[] = []
      const stream = {
        isTTY: true,
        columns: 100,
        write: (chunk: string) => {
          chunks.push(chunk)
          return true
        },
      } as unknown as NodeJS.WriteStream
      const startup = createPhaseReporter({ animated: true, stream })
      reporters.push(startup)
      startup.update(snapshot({ phase: 'bundle', message: 'Bundling app', index: 4 }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }))
      const settled = chunks.length

      holdScreen()()
      vi.advanceTimersByTime(240)
      expect(chunks.length).toBe(settled)
    }
    finally {
      vi.useRealTimers()
    }
  })

  describe('with a meter', () => {
    beforeEach(() => stubUnicode(true))
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    const prerendering = (meter: ProgressSnapshot['meter']) => snapshot({
      phase: 'prerender',
      message: 'Prerendering routes',
      index: 4,
      meter,
    })

    function terminal(columns: number) {
      const chunks: string[] = []
      const stream = {
        isTTY: true,
        columns,
        write: (chunk: string) => {
          chunks.push(chunk)
          return true
        },
      } as unknown as NodeJS.WriteStream
      const startup = createPhaseReporter({ animated: true, stream })
      reporters.push(startup)
      const line = () => stripVTControlCharacters(chunks.join('').split('\r').at(-1)!).slice(2)
      return { startup, chunks, line }
    }

    it('should draw a bar with the count and the last item', () => {
      freezeClock()
      const { startup, line } = terminal(120)
      startup.update(prerendering({ done: 5, total: 20, detail: '/blog/hello' }))

      expect(line()).toBe(`Prerendering routes ${'━'.repeat(20)} 5/20 0.0ms /blog/hello`)
    })

    it('should cut the last item to fit the terminal', () => {
      freezeClock()
      const { startup, line } = terminal(64)
      startup.update(prerendering({ done: 1, total: 2, detail: '/a/very/long/route/that/does/not/fit' }))

      expect(line()).toMatch(/^Prerendering routes \S+ 1\/2 0\.0ms …\S+\/not\/fit$/)
      expect(line().length + 2).toBeLessThan(64)
    })

    it('should leave the last item out when there is no room for it', () => {
      freezeClock()
      const { startup, line } = terminal(40)
      startup.update(prerendering({ done: 1, total: 2, detail: '/about' }))

      expect(line()).toBe(`Prerendering routes ${'━'.repeat(20)} 1/2 0.0ms`)
    })

    it('should leave a moving meter to the next frame', () => {
      vi.useFakeTimers()
      freezeClock()
      try {
        const { startup, chunks, line } = terminal(120)
        startup.update(prerendering({ done: 0, total: 2 }))
        chunks.length = 0
        startup.update(prerendering({ done: 1, total: 2, detail: '/' }))

        expect(chunks).toEqual([])
        vi.advanceTimersByTime(80)
        expect(line()).toContain('1/2 0.0ms /')
      }
      finally {
        vi.useRealTimers()
      }
    })

    it('should repeat the count when there is no animated line', async () => {
      const renderer = await render(async ({ waitForOutput }) => {
        const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
        reporters.push(startup)
        startup.update(prerendering({ done: 0, total: 3 }))
        startup.update(prerendering({ done: 2, total: 3, detail: '/about' }))
        await waitForOutput(/Prerendering routes 2\/3/)
      })

      expect(screen(renderer)).toMatch(/Prerendering routes 2\/3 \(/)
      expect(screen(renderer)).not.toContain('━')
    })
  })

  it('should redraw only the spinner while the rest of the line is unchanged', () => {
    vi.useFakeTimers()
    freezeClock()
    const chunks: string[] = []
    const stream = {
      isTTY: true,
      write: (chunk: string) => {
        chunks.push(chunk)
        return true
      },
    } as unknown as NodeJS.WriteStream
    const startup = createPhaseReporter({ animated: true, stream })
    try {
      startup.update(snapshot({ message: 'Bundling app', elapsed: 5000, phaseElapsed: 5000 }))
      chunks.length = 0
      vi.advanceTimersByTime(80)

      expect(chunks.join('')).not.toContain('Bundling app')
      expect(chunks.join('')).not.toContain('\u001B[2K')
    }
    finally {
      startup.stop()
      vi.useRealTimers()
    }
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
      ◆  Ready in 2.40s
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

  it('should only report a bundle when it starts, not when one finishes', async () => {
    const renderer = await render(() => {
      const startup = reporter(false)
      startup.update(snapshot({ phase: 'build', message: 'Building' }))
      startup.update(snapshot({ phase: 'bundle:client', message: 'Bundling client' }))
      startup.update(snapshot({ phase: 'bundle:client+server', message: 'Bundling client and server' }))
      startup.update(snapshot({ phase: 'bundle:server', message: 'Bundling server' }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ●  Building
      │
      ●  Bundling client
      │
      ●  Bundling client and server"
    `)
  })

  it('should repeat a long phase when there is no animated line', async () => {
    const renderer = await render(async ({ waitForOutput }) => {
      const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
      reporters.push(startup)
      startup.update(snapshot({
        phase: 'server',
        message: 'Building Nitro server',
        index: 5,
        elapsed: 4000,
      }))
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

  it('should say how long the phase has taken when it names what it is doing', async () => {
    const renderer = await render(async ({ waitForOutput }) => {
      const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
      reporters.push(startup)
      startup.update(snapshot({
        phase: 'types',
        message: 'Generating types',
        index: 3,
        elapsed: 8000,
        phaseElapsed: 8000,
      }))
      await waitForOutput('Generating types')
      startup.update(snapshot({
        phase: 'types',
        message: 'Generating server types',
        index: 3,
        elapsed: 41_000,
        phaseElapsed: 33_000,
      }))
      await waitForOutput('Generating server types')
    })

    expect(screen(renderer)).toContain('Generating server types (33.0s \u00B7 total 41.0s)')
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
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Compiling the first request',
        index: 6,
        elapsed: 2400,
      }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        serving: true,
        elapsed: 8100,
      }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ◆  Ready in 2.40s · compiling the first request
      │
      ◆  Serving in 8.10s"
    `)
  })

  it('should print the URL next to the summary', async () => {
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.setURL('http://localhost:3000/')
      startup.update(snapshot())
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ◆  Ready in 2.40s  → http://localhost:3000/"
    `)
  })

  it('should report a render the server is busy with after it is ready', async () => {
    freezeClock()
    const renderer = await render(() => {
      const startup = reporter(true)
      startup.update(snapshot())
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
        pending: { label: 'GET /', startedAt: Date.now() - 4200 },
      }))
    })

    expect(screen(renderer)).toMatch(/^. rendering GET \/ 4\.20s$/m)
  })

  it('should announce a render once where the line cannot be redrawn', async () => {
    freezeClock()
    const renderer = await render(() => {
      const startup = reporter(false)
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }))
      const pending = { label: 'GET /', startedAt: Date.now() - 6400 }
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
        pending,
      }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
        pending,
      }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        serving: true,
        elapsed: 16_800,
      }))
    })

    expect(screen(renderer)).toMatchInlineSnapshot(`
      "│
      ◆  Ready in 2.40s
      │
      ●  Rendering GET /
      │
      ◆  First render in 6.40s"
    `)
  })

  it('should announce being ready once, however many times it is told', async () => {
    const renderer = await render(() => {
      const startup = reporter(false)
      const ready = snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      })
      startup.update(ready)
      startup.update(ready)
      startup.update(snapshot({ status: 'loading', phase: 'config', message: 'Loading Nuxt config' }))
      startup.update({ ...ready, reload: true })
    })

    expect(screen(renderer).match(/Ready in/g)).toHaveLength(1)
  })

  it('should repeat a render that has not landed, where the line cannot be redrawn', async () => {
    const renderer = await render(async ({ waitForOutput }) => {
      const startup = createPhaseReporter({ animated: false, heartbeat: 20 })
      reporters.push(startup)
      const ready = {
        status: 'ready' as const,
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }
      startup.update(snapshot(ready))
      startup.update(snapshot({
        ...ready,
        pending: { label: 'GET /', startedAt: Date.now() - 12_500 },
      }))
      await waitForOutput(/Rendering GET \/[\s\S]*Rendering GET \/[\s\S]*\(12\.\ds\)/)
    })

    expect(screen(renderer)).toContain('Rendering GET /')
  })

  it('should not close off a wait it never reported', async () => {
    const renderer = await render(() => {
      const startup = reporter(false)
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        elapsed: 2400,
      }))
      startup.update(snapshot({
        status: 'ready',
        phase: 'ready',
        message: 'Ready',
        index: 6,
        serving: true,
        elapsed: 2600,
      }))
    })

    expect(screen(renderer)).toBe('│\n◆  Ready in 2.40s')
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
    expect(formatSummary(snapshot({
      status: 'ready',
      reload: true,
      serving: true,
      elapsed: 900,
    }))).toBe('Reloaded in 900ms')
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

    expect(screen(renderer)).toMatch(/^. Bundling app 0\.0ms$/)
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

describe('formatMeter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should fill the bar in proportion to what is done', () => {
    stubUnicode(true)
    expect(formatMeter({ done: 3, total: 4 }, 8)).toBe(`${styleText('green', '━'.repeat(6))}${styleText('gray', '━'.repeat(2))} ${styleText('gray', '3/4')}`)
  })

  it('should draw an empty bar when nothing is known yet', () => {
    stubUnicode(true)
    expect(stripVTControlCharacters(formatMeter({ done: 0, total: 0 }, 4))).toBe('━━━━ 0/0')
  })

  it('should fall back to ascii where the terminal cannot draw the bar', () => {
    stubUnicode(false)
    expect(stripVTControlCharacters(formatMeter({ done: 1, total: 2 }, 4))).toBe('==== 1/2')
  })
})

describe('formatPhaseTable', () => {
  it('places each phase where it ran', () => {
    const table = formatPhaseTable([
      {
        phase: 'config',
        message: '',
        duration: 1000,
        start: 0,
      },
      {
        phase: 'types',
        message: '',
        duration: 5,
        start: 1000,
      },
      {
        phase: 'client',
        message: '',
        duration: 2000,
        start: 1005,
      },
      {
        phase: 'server',
        message: '',
        duration: 1000,
        start: 1005,
      },
      {
        phase: 'prerender',
        message: '',
        duration: 1000,
        start: 3005,
      },
    ])
    expect(stripVTControlCharacters(table).split('\n')).toEqual([
      `config     ${'█'.repeat(6)}${' '.repeat(18)}  1.00s`,
      `client     ${' '.repeat(6)}${'█'.repeat(12)}${' '.repeat(6)}  2.00s`,
      `server     ${' '.repeat(6)}${'█'.repeat(6)}${' '.repeat(12)}  1.00s`,
      `prerender  ${' '.repeat(18)}${'█'.repeat(6)}  1.00s`,
    ])
  })

  it('lays out phases one after the other when they carry no start', () => {
    const table = formatPhaseTable([
      { phase: 'config', message: '', duration: 1000 },
      { phase: 'build', message: '', duration: 3000 },
    ])
    expect(stripVTControlCharacters(table).split('\n')).toEqual([
      `config  ${'█'.repeat(6)}${' '.repeat(18)}  1.00s`,
      `build   ${' '.repeat(6)}${'█'.repeat(18)}  3.00s`,
    ])
  })
})
