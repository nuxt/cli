import process from 'node:process'

/**
 * Present a piped fork's stdio as a terminal.
 *
 * When the parent runs the interactive dev UI it pipes this fork's stdio so the
 * panel can stay below all output. Everything that formats output (consola's
 * fancy reporter, colour detection) reads `isTTY` at module load, so this must
 * run first and must not import anything that loads `std-env` or `consola`.
 */
if (process.env.__NUXT_DEV_PIPED_TTY__) {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.isTTY) {
      continue
    }
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(stream, 'columns', {
      get: () => Number(process.env.__NUXT_DEV_COLUMNS__) || 80,
      configurable: true,
    })
    const depth = Number(process.env.__NUXT_DEV_COLOR_DEPTH__) || (process.env.FORCE_COLOR ? 8 : 1)
    Object.defineProperty(stream, 'getColorDepth', { value: () => depth, configurable: true })
    Object.defineProperty(stream, 'hasColors', {
      value: (count?: number) => depth >= 4 && (typeof count !== 'number' || count <= 2 ** depth),
      configurable: true,
    })
    for (const method of ['cursorTo', 'moveCursor', 'clearLine', 'clearScreenDown'] as const) {
      if (typeof (stream as any)[method] !== 'function') {
        Object.defineProperty(stream, method, {
          value: (...args: unknown[]) => {
            const callback = args.find(arg => typeof arg === 'function') as (() => void) | undefined
            callback?.()
            return true
          },
          configurable: true,
        })
      }
    }
  }
}
