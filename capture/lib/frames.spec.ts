import type { Chunk } from './pty.ts'

import { describe, expect, it } from 'vitest'
import { buildFingerprint } from './frames.ts'
import { resolveRules, scrubLine } from './scrub.ts'

/**
 * How each progress display we record repaints. They disagree, and reading only
 * the buffer as it stands lost whichever states arrived in the same read as
 * their replacement.
 */
const REPAINTS = {
  'clack (home, erase to end of screen)': '\u001B[1G\u001B[J',
  'consola (return, erase line)': '\r\u001B[2K',
  'dev UI (up, erase line)': '\u001B[1A\u001B[2K',
}

function transcript(repaint: string): string {
  return [
    '\u001B[90m┌\u001B[39m  Welcome to Nuxt!\r\n',
    `\u001B[35m◒\u001B[39m  Downloading minimal template${repaint}`,
    `\u001B[35m◐\u001B[39m  Downloading minimal template${repaint}`,
    '\u001B[32m◇\u001B[39m  Downloaded minimal template\r\n',
    '└  ✨ Happy building!\r\n',
  ].join('')
}

function fingerprint(chunks: string[]): string {
  const asChunks: Chunk[] = chunks.map((data, index) => ({ at: index * 10, data }))
  return buildFingerprint(asChunks, { rows: 24, scrubRules: ['spinner'] })
}

/** Ways the operating system could have split the same output into reads. */
function chunkings(data: string): string[][] {
  return [
    [data],
    [...data],
    data.match(/.{1,7}/gs)!,
    data.match(/.{1,64}/gs)!,
  ]
}

describe('capture fingerprint', () => {
  for (const [name, repaint] of Object.entries(REPAINTS)) {
    describe(name, () => {
      it('should not depend on how output was split into reads', () => {
        const results = chunkings(transcript(repaint)).map(fingerprint)
        for (const result of results) {
          expect(result).toBe(results[0])
        }
      })

      it('should keep a line that was drawn over', () => {
        for (const chunks of chunkings(transcript(repaint))) {
          expect(fingerprint(chunks)).toContain('Downloading minimal template')
        }
      })
    })
  }
})

describe('scrubbing a right-aligned tag', () => {
  const TAG = 'nitro'
  const WIDTH = 96

  /** One consola line as it would be rendered for a given real duration. */
  function rendered(duration: string): string {
    const message = `✔ Nuxt Nitro server built in ${duration}`
    return message + ' '.repeat(WIDTH - message.length - TAG.length) + TAG
  }

  function scrub(duration: string): string {
    const line = rendered(duration)
    const styles = Array.from({ length: line.length }).fill(undefined) as never
    return scrubLine(line, styles, resolveRules(['timings'])).line
  }

  it('should put the tag in the same column however long the duration was', () => {
    const durations = ['1085 ms', '986 ms', '9 ms', '42 ms', '1.2 s']
    const scrubbed = durations.map(scrub)

    for (const line of scrubbed) {
      expect(line).toBe(scrubbed[0])
      expect(line).toHaveLength(WIDTH)
    }
  })

  it('should leave indentation and gaps inside a message alone', () => {
    const untagged = [
      '   config 1085 ms · modules 42 ms',
      '●  Nuxt 1085 ms and more',
      '  ➜ DevTools: 1085 ms',
      '  Ready in 1085 ms  → http://localhost:3000/',
    ]

    for (const content of untagged) {
      const line = content.padEnd(WIDTH)
      const styles = Array.from({ length: line.length }).fill(undefined) as never

      expect(scrubLine(line, styles, resolveRules(['timings'])).line.trimEnd())
        .toBe(content.replaceAll('1085 ms', '42 ms'))
    }
  })

  it('should keep the styles aligned with the re-padded line', () => {
    const line = rendered('1085 ms')
    const styles = Array.from({ length: line.length }, (_, index) => index) as never
    const result = scrubLine(line, styles, resolveRules(['timings']))

    expect(result.styles).toHaveLength(result.line.length)
  })

  it('should leave a line without padding alone', () => {
    expect(scrub('42 ms').trimEnd()).not.toBe('')
    const plain = '✔ Vite client built in 1085 ms'
    const styles = Array.from({ length: plain.length }).fill(undefined) as never

    expect(scrubLine(plain, styles, resolveRules(['timings'])).line).toBe('✔ Vite client built in 42 ms')
  })
})
