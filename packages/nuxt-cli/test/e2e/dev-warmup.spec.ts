import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPort } from 'get-port-please'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initialize } from '../../src/dev'
import { createDevFixture } from '../utils'

const fixtureDir = await createDevFixture('dev-warmup')

/**
 * Records every page render the app runs, from inside the handler the gate is
 * protecting: how many were already in flight when this one started, and long
 * enough that a second request would overlap it if nothing held it back.
 */
const MIDDLEWARE = `import { defineEventHandler, getRequestHeader } from 'h3'

export default defineEventHandler(async (event) => {
  if (!getRequestHeader(event, 'accept')?.includes('text/html')) {
    return
  }
  const state = (globalThis.__renders ??= { active: 0, entries: [] })
  state.active++
  state.entries.push(state.active)
  await new Promise(resolve => setTimeout(resolve, 300))
  state.active--
})
`

const ENDPOINT = `import { defineEventHandler } from 'h3'

export default defineEventHandler(() => ({ entries: globalThis.__renders?.entries ?? [] }))
`

/** How many renders were in flight as each one started, oldest first. */
async function renders(base: string): Promise<number[]> {
  const { entries } = await fetch(`${base}/api/renders`, { headers: { accept: 'application/json' } })
    .then(response => response.json()) as { entries: number[] }
  return entries
}

function documents(base: string, count: number): Promise<Response[]> {
  return Promise.all(Array.from({ length: count }, () => fetch(base, { headers: { accept: 'text/html' } })))
}

const host = '127.0.0.1'
let base: string
let close: () => Promise<void>

describe('the warmup gate', () => {
  beforeAll(async () => {
    await mkdir(join(fixtureDir, 'server/middleware'), { recursive: true })
    await writeFile(join(fixtureDir, 'server/middleware/renders.ts'), MIDDLEWARE)
    await writeFile(join(fixtureDir, 'server/api/renders.ts'), ENDPOINT)

    const port = await getPort({ host, port: 3089 })
    base = `http://${host}:${port}`
    const server = await initialize({ cwd: fixtureDir, args: {} }, {
      listenOverrides: { hostname: host, port },
      showBanner: false,
    })
    close = server.close
  }, 120_000)

  afterAll(async () => {
    await close?.()
  })

  it('should render the first page on its own', { timeout: 120_000 }, async () => {
    const responses = await documents(base, 2)
    expect(responses.every(response => response.ok)).toBe(true)

    // Two requests, neither overlapping: the second waits for the compile the
    // first is paying for.
    expect(await renders(base)).toEqual([1, 1])
  })

  it('should stop gating once the app is warm', { timeout: 120_000 }, async () => {
    const before = await renders(base)
    await documents(base, 20)
    const entries = await renders(base)

    expect(entries.length).toBe(before.length + 20)
    // A warm render costs tens of milliseconds, so there is nothing left to
    // protect and the gate is out of the way entirely.
    expect(Math.max(...entries.slice(before.length))).toBeGreaterThan(1)
  })
})
