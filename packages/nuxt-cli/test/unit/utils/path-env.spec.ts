import { delimiter } from 'pathe'
import { describe, expect, it } from 'vitest'

import { withLocalBinPath, withPrependedPath } from '../../../src/utils/path-env'

describe('withPrependedPath', () => {
  it('reuses an existing path key regardless of case', () => {
    const env = withPrependedPath({ Path: '/usr/bin' }, ['/local/bin'])

    expect(env).toEqual({ Path: `/local/bin${delimiter}/usr/bin` })
  })

  it('creates a path when none is set', () => {
    expect(withPrependedPath({}, ['/local/bin'])).toEqual({ PATH: '/local/bin' })
  })
})

describe('withLocalBinPath', () => {
  it('prepends the local bin directory of the given directory', () => {
    const env = withLocalBinPath('/project', { PATH: '/usr/bin' })

    expect(env.PATH).toBe(`/project/node_modules/.bin${delimiter}/usr/bin`)
  })
})
