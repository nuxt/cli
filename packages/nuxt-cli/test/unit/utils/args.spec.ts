import { resolve } from 'pathe'
import { describe, expect, it } from 'vitest'

import { normaliseCwdArg, replaceCwdArg } from '../../../src/utils/args'

function normalise(rawArgs: string[]): string[] {
  normaliseCwdArg(rawArgs)
  return rawArgs
}

describe('normaliseCwdArg', () => {
  it('should rewrite a bare --cwd to its inline form', () => {
    expect(normalise(['build', '--cwd', 'apps/web'])).toEqual(['build', '--cwd=apps/web'])
    expect(normalise(['--cwd', 'apps/web'])).toEqual(['--cwd=apps/web'])
  })

  it('should move --cwd after the command name', () => {
    expect(normalise(['--cwd', 'apps/web', 'build'])).toEqual(['build', '--cwd=apps/web'])
    expect(normalise(['--cwd=apps/web', 'build', '--prerender'])).toEqual(['build', '--prerender', '--cwd=apps/web'])
  })

  it('should keep the last of several occurrences', () => {
    expect(normalise(['--cwd', 'apps/docs', 'build', '--cwd=apps/web'])).toEqual(['build', '--cwd=apps/web'])
  })

  it('should leave the ROOTDIR positional in place', () => {
    expect(normalise(['build', 'apps/web'])).toEqual(['build', 'apps/web'])
    expect(normalise(['--cwd', 'apps/docs', 'build', 'apps/web'])).toEqual(['build', 'apps/web', '--cwd=apps/docs'])
  })

  it('should ignore --cwd after a -- separator', () => {
    expect(normalise(['test', '--', '--cwd', 'apps/web'])).toEqual(['test', '--', '--cwd', 'apps/web'])
  })

  it('should keep --cwd ahead of a -- separator', () => {
    expect(normalise(['--cwd', 'apps/web', 'test', '--', '--watch'])).toEqual(['test', '--cwd=apps/web', '--', '--watch'])
    expect(normalise(['test', '--cwd=apps/web', '--', '--watch'])).toEqual(['test', '--cwd=apps/web', '--', '--watch'])
  })
})

describe('replaceCwdArg', () => {
  const previous = resolve('apps/web')

  function replace(rawArgs: string[]): string[] {
    replaceCwdArg(rawArgs, '/projects/site', previous)
    return rawArgs
  }

  it('should replace an existing --cwd', () => {
    expect(replace(['dev', '--cwd=apps/web'])).toEqual(['dev', '--cwd=/projects/site'])
  })

  it('should drop a ROOTDIR positional naming the previous directory', () => {
    expect(replace(['dev', 'apps/web', '--port=3000'])).toEqual(['dev', '--port=3000', '--cwd=/projects/site'])
  })

  it('should keep positionals that name something else', () => {
    expect(replace(['dev', 'apps/docs'])).toEqual(['dev', 'apps/docs', '--cwd=/projects/site'])
  })

  it('should leave arguments after a -- separator alone', () => {
    expect(replace(['dev', '--', 'apps/web'])).toEqual(['dev', '--cwd=/projects/site', '--', 'apps/web'])
  })
})
