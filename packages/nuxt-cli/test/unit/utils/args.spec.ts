import { resolve } from 'pathe'
import { describe, expect, it } from 'vitest'

import { replaceCwdArg } from '../../../src/utils/args'

describe('replaceCwdArg', () => {
  const previous = resolve('apps/web')

  function replace(rawArgs: string[]): string[] {
    replaceCwdArg(rawArgs, '/projects/site', previous)
    return rawArgs
  }

  it('should replace an existing --cwd', () => {
    expect(replace(['dev', '--cwd=apps/web'])).toEqual(['dev', '--cwd=/projects/site'])
    expect(replace(['dev', '--cwd', 'apps/web'])).toEqual(['dev', '--cwd=/projects/site'])
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
