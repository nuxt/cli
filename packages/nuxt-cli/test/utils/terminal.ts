import type { Renderer } from 'ansivision'

import process from 'node:process'

import { RenderStream } from 'ansivision'
import { vi } from 'vitest'

export interface RenderContext {
  /** Wait for `matcher` to show up in the output, for asynchronous logs. */
  waitForOutput: (matcher: string | RegExp) => Promise<void>
}

/**
 * Replay everything written to the terminal through a virtual one, so tests can
 * assert on what a user would see rather than on raw escape sequences.
 *
 * Both sinks feed the same stream so escape sequences stay ordered relative to
 * the logs; `console.log` cannot be left to `process.stdout` because vitest
 * replaces the global console.
 */
export async function render(run: (context: RenderContext) => unknown): Promise<Renderer> {
  const stream = new RenderStream()
  let output = ''
  const capture = (chunk: string) => {
    output += chunk
    stream.write(chunk)
  }

  const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => capture(`${args.join(' ')}\n`))
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    capture(chunk as string)
    return true
  })

  try {
    await run({
      waitForOutput: matcher => vi.waitFor(() => {
        if (!output.match(matcher)) {
          throw new Error(`Timed out waiting for ${matcher} in terminal output`)
        }
      }),
    })
  }
  finally {
    log.mockRestore()
    write.mockRestore()
  }

  // The renderer only catches up once the stream has drained.
  await new Promise<void>(resolve => stream.end(resolve))
  return stream.renderer
}

/**
 * The visible screen. `ansivision` starts a new frame whenever the screen is
 * cleared, so the last frame is what is on screen now.
 */
export function screen(renderer: Renderer): string {
  return (renderer.frames.at(-1) ?? '')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replaceAll(/^\n+|\n+$/g, '')
}

/** Foreground colour of the first character of `text` on screen. */
export function colourOf(renderer: Renderer, text: string): unknown {
  const lines = (renderer.frames.at(-1) ?? '').split('\n')
  const row = lines.findIndex(line => line.includes(text))
  return renderer.getStyleAtPosition(row, lines[row]!.indexOf(text)).foreground
}
