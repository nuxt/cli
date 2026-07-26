import type { Nuxt } from '@nuxt/schema'

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCommand } from 'citty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import analyze from '../../../src/commands/analyze'
import { render, screen } from '../../utils/terminal'

type Hook = (...args: any[]) => unknown

function createHooks() {
  const hooks = new Map<string, Hook[]>()
  return {
    hook: (name: string, fn: Hook) => void hooks.set(name, [...hooks.get(name) || [], fn]),
    callHook: async (name: string, ...args: unknown[]) => {
      for (const fn of hooks.get(name) || []) {
        await fn(...args)
      }
    },
  }
}

const { loadNuxt, buildNuxt } = vi.hoisted(() => ({
  loadNuxt: vi.fn(),
  buildNuxt: vi.fn(),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({ loadNuxt, buildNuxt }),
}))

let cwd: string

/**
 * Runs the command against a stub Nuxt, driving the same sequence Nitro does:
 * route rules and explicit routes are gathered into a set, `prerender:routes`
 * gets a chance to change it, and `prerender.ignore` filters what is left.
 */
async function runAnalyze({ args = [], routes = [] }: { args?: string[], routes?: string[] } = {}) {
  const nuxtHooks = createHooks()
  const prerenderRoutes = new Set(routes)
  let overrides: Record<string, any> = {}

  loadNuxt.mockImplementation((options: { overrides: Record<string, any> }) => {
    overrides = options.overrides
    return Promise.resolve({
      ...nuxtHooks,
      ready: () => Promise.resolve(),
      options: {
        analyzeDir: join(cwd, 'analyze'),
        buildDir: join(cwd, '.nuxt'),
        rootDir: cwd,
        nitro: {},
        build: {},
      },
    } as unknown as Nuxt)
  })

  buildNuxt.mockImplementation(async () => {
    await mkdir(join(cwd, 'analyze'), { recursive: true })
    const nitroHooks = createHooks()
    await nuxtHooks.callHook('nitro:init', { hooks: nitroHooks })
    await nitroHooks.callHook('prerender:routes', prerenderRoutes)
  })

  const renderer = await render(() => runCommand(analyze, { rawArgs: [`--cwd=${cwd}`, '--no-serve', ...args] }))

  const ignore: ((path: string) => unknown)[] = overrides.nitro?.prerender?.ignore || []
  return {
    output: screen(renderer),
    overrides,
    prerendered: [...prerenderRoutes].filter(route => !ignore.some(matches => matches(route))),
  }
}

describe('nuxt analyze command', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-analyze-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('should not prerender any routes by default', async () => {
    const { prerendered, overrides } = await runAnalyze({ routes: ['/', '/about'] })
    expect(prerendered).toEqual([])
    expect(overrides.nitro.prerender.crawlLinks).toBe(false)
  })

  it('should report the routes it skipped prerendering', async () => {
    const { output } = await runAnalyze({ routes: ['/', '/about'] })
    expect(output).toContain('Skipped prerendering 2 routes')
    expect(output).toContain('--prerender')
  })

  it('should say nothing when there was nothing to prerender', async () => {
    const { output } = await runAnalyze()
    expect(output).not.toContain('prerender')
  })

  it('should prerender when the --prerender flag is passed', async () => {
    const { prerendered, overrides, output } = await runAnalyze({ args: ['--prerender'], routes: ['/', '/about'] })
    expect(prerendered).toEqual(['/', '/about'])
    expect(overrides.nitro?.prerender).toBeUndefined()
    expect(output).not.toContain('Skipped prerendering')
  })
})
