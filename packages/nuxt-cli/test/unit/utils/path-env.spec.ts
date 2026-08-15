import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { delimiter, join } from 'pathe'
import { afterEach, describe, expect, it } from 'vitest'

import { findInPath, withLocalBinPath, withPrependedPath } from '../../../src/utils/path-env'

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

describe('findInPath', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function binDir(...names: string[]): string {
    const directory = mkdtempSync(join(tmpdir(), 'nuxt-path-env-'))
    directories.push(directory)
    for (const name of names) {
      const file = join(directory, name)
      writeFileSync(file, '')
      chmodSync(file, 0o755)
    }
    return directory
  }

  // Windows resolves a bare name through the extensions in `PATHEXT`, so the file
  // on disk is named for the platform under test, and `PATHEXT` is passed rather
  // than inherited so the runner's own value cannot change what is looked for.
  const suffix = process.platform === 'win32' ? '.CMD' : ''
  const pathExt = { PATHEXT: '.CMD' }

  it('should find a binary on the given path', () => {
    const directory = binDir(`nuxt-thing${suffix}`)

    expect(findInPath('nuxt-thing', { ...pathExt, PATH: directory })).toBe(join(directory, `nuxt-thing${suffix}`))
  })

  it('should return nothing for a binary that is not on the path', () => {
    expect(findInPath('nuxt-thing', { ...pathExt, PATH: binDir() })).toBeUndefined()
  })

  it('should read the path from whichever key holds it', () => {
    const directory = binDir(`nuxt-thing${suffix}`)

    expect(findInPath('nuxt-thing', { ...pathExt, Path: directory })).toBeDefined()
  })
})
