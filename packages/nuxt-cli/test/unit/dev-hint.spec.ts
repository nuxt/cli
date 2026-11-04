import type { DevServerHint } from '../../src/utils/dev-hint'

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

  it('should round-trip `allowedHosts`', () => {
    mkdirSync(join(cwd, 'node_modules'))
    saveDevServerHint(cwd, { allowedHosts: ['alias.test'] })
    expect(loadDevServerHint(cwd)).toEqual({ allowedHosts: ['alias.test'] })

    saveDevServerHint(cwd, { allowedHosts: true })
    expect(loadDevServerHint(cwd)).toEqual({ allowedHosts: true })
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

  it('should keep only fields of the expected type', () => {
    mkdirSync(join(cwd, 'node_modules/.cache/nuxt'), { recursive: true })
    const path = join(cwd, 'node_modules/.cache/nuxt/dev-server.json')
    writeFileSync(path, JSON.stringify({ hostname: {}, port: '3000', https: 'true', baseURL: 42 }))

    expect(loadDevServerHint(cwd)).toEqual({})
  })

  it('should not persist a non-string `hostname`', () => {
    mkdirSync(join(cwd, 'node_modules'))
    saveDevServerHint(cwd, { hostname: {}, port: 3000 } as unknown as DevServerHint)

    const path = join(cwd, 'node_modules/.cache/nuxt/dev-server.json')
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ port: 3000 })
  })
})
