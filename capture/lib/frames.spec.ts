import type { Chunk } from './pty.ts'

import { describe, expect, it } from 'vitest'
import { buildFingerprint } from './frames.ts'

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
