import { Buffer } from 'node:buffer'
import process from 'node:process'
import { Writable } from 'node:stream'

import { outro } from '@clack/prompts'
import { describe, expect, it } from 'vitest'

import { blankLineBefore, observeOutput, trackOutputSpacing } from '../../../src/utils/stdout'

/** The gap a nudge would leave after `previous` was written. */
function gapAfter(previous: string): string {
  observeOutput(previous)
  return blankLineBefore()
}

describe('blankLineBefore', () => {
  it.each([
    ['a command that ended its last line', 'Build complete\n', '\n'],
    ['clack\'s outro, which already leaves a blank line', '└  Happy building!\n\n', ''],
    ['output that stopped mid-line', 'Building...', '\n\n'],
    ['more blank lines than are needed', 'done\n\n\n\n', ''],
  ])('leaves one blank line after %s', (_label, previous, expected) => {
    expect(gapAfter(previous)).toBe(expected)
  })

  it('should count newlines written on their own', () => {
    observeOutput('Build complete\n')
    observeOutput('\n')
    expect(blankLineBefore()).toBe('')
  })

  it('should ignore an empty write', () => {
    observeOutput('Building...')
    observeOutput('')
    expect(blankLineBefore()).toBe('\n\n')
  })

  it('should read the tail of a buffer as it would a string', () => {
    expect(gapAfter('reset\n')).toBe('\n')
    observeOutput(Buffer.from('café\n\n', 'utf8'))
    expect(blankLineBefore()).toBe('')
  })

  // `init` signs off with clack's outro, which is the one caller that already
  // leaves a blank line behind it.
  it('should add nothing after a real clack outro', () => {
    let written = ''
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk)
        callback()
      },
    })
    outro('Happy building!', { output })

    gapAfter('reset\n')
    observeOutput(written)
    expect(blankLineBefore()).toBe('')
  })
})

describe('trackOutputSpacing', () => {
  it('should observe what other code writes to stdout', () => {
    const original = process.stdout.write
    const written: string[] = []
    process.stdout.write = ((chunk: string) => {
      written.push(chunk)
      return true
    }) as typeof process.stdout.write

    try {
      trackOutputSpacing()
      gapAfter('reset\n')
      process.stdout.write('a line of output\n\n')
      expect(blankLineBefore()).toBe('')
      expect(written).toEqual(['a line of output\n\n'])
    }
    finally {
      process.stdout.write = original
    }
  })
})
