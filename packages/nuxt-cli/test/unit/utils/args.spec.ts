import { describe, expect, it } from 'vitest'

import { normaliseCwdArg } from '../../../src/utils/args'

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
})
