import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadDevServerHint, saveDevServerHint } from '../../src/utils/dev-hint'

describe('dev server hint', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'nuxi-hint-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('should round-trip the resolved address', () => {
    mkdirSync(join(cwd, 'node_modules'))
    saveDevServerHint(cwd, { port: 4000, hostname: '127.0.0.1', https: false, baseURL: '/app/' })
    expect(loadDevServerHint(cwd)).toEqual({ port: 4000, hostname: '127.0.0.1', https: false, baseURL: '/app/' })
  })

  it('should not write outside an installed `node_modules`', () => {
    saveDevServerHint(cwd, { port: 4000 })
    expect(loadDevServerHint(cwd)).toBeUndefined()
  })

  it('should return nothing for a corrupt hint', () => {
    mkdirSync(join(cwd, 'node_modules/.cache/nuxt'), { recursive: true })
    const path = join(cwd, 'node_modules/.cache/nuxt/dev-server.json')
    saveDevServerHint(cwd, { port: 4000 })
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ port: 4000 })

    writeFileSync(path, '{ not json', 'utf-8')
    expect(loadDevServerHint(cwd)).toBeUndefined()
  })
})
