import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { record } from '../../../capture/lib/pty.ts'

const cwd = fileURLToPath(new URL('../..', import.meta.url))
const bin = fileURLToPath(new URL('../../../packages/nuxt-cli/bin/nuxi.mjs', import.meta.url))

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[\d;?]*[a-z]/gi

function plain(output: string): string {
  return output.replace(ANSI, '')
}

/** The process answering on `port`, which is the one serving the app. */
async function servingPid(port: number): Promise<number | undefined> {
  return await fetch(`http://localhost:${port}/api/pid`)
    .then(response => response.json() as Promise<{ pid: number }>)
    .then(body => body.pid)
    .catch(() => undefined)
}

/**
 * Wait until the app is served by a process other than `previous`.
 *
 * The restart is announced before the fork is serving and the outgoing server
 * holds the port until the handover is through, so only which process answers
 * says the fork has taken over.
 */
async function waitForHandover(port: number, previous: number, timeout = 120_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const pid = await servingPid(port)
    if (pid !== undefined && pid !== previous) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`no fork took over port ${port} within ${timeout}ms`)
}

async function runDevUI(port: number, options: { restart?: boolean } = {}): Promise<string> {
  const session = record(`NUXT_IGNORE_LOCK=1 NUXT_TUI=1 node ${bin} dev --port ${port} --no-takeover`, {
    cwd,
    rows: 40,
    columns: 100,
    env: {},
  })
  try {
    await session.waitFor(/watching for changes/, 180_000)
    // The first server runs in the CLI's own process; a fork serves after a restart.
    if (options.restart) {
      const before = await servingPid(port)
      session.send('r')
      await session.waitFor(/Restarting Nuxt in a new process/, 60_000)
      await waitForHandover(port, before!)
    }
    await fetch(`http://localhost:${port}/api/log`).then(response => response.text())
    await session.wait(3000)
    session.send('l')
    await session.wait(2000)
    return plain(session.output())
  }
  finally {
    await session.stop()
  }
}

describe('dev ui on nuxt nightly', () => {
  it('should start without tripping import protection', async () => {
    const output = await runDevUI(3211)

    expect(output).not.toContain('not allowed in server runtime')
    expect(output).toContain('watching for changes')
  }, 240_000)

  it('should attribute the app\'s logs to the request that caused them', async () => {
    const output = await runDevUI(3212)

    expect(output).toContain('log from the server route')
    expect(output).toMatch(/GET \/api\/log[\s\S]*log from the server route/)
  }, 240_000)

  it('should show an app log once when a fork is serving it', async () => {
    const output = await runDevUI(3213, { restart: true })

    expect(output.split('log from the server route')).toHaveLength(2)
  }, 240_000)

  it('should trace a page through its middleware, data fetching and render', async () => {
    const session = record(`NUXT_IGNORE_LOCK=1 NUXT_TUI=1 node ${bin} dev --port 3214 --no-takeover`, {
      cwd,
      rows: 80,
      columns: 140,
      env: {},
    })
    try {
      await session.waitFor(/ready in/, 180_000)
      await fetch('http://localhost:3214/trace').then(response => response.text())
      await session.wait(2000)
      session.send('n')
      await session.wait(500)
      session.send('/')
      session.send('trace')
      session.send('\r')
      session.send('\u001B[B')
      await session.wait(500)
      session.send('\r')
      await session.wait(1500)
      const trace = plain(session.output()).split('trace · GET /trace').at(-1)!

      expect(trace).toContain('timeline')
      expect(trace).toMatch(/middleware\s+traced/)
      expect(trace).toMatch(/data\s+useFetch\(/)
      expect(trace).toMatch(/route\s+GET \/api\/pid/)
      expect(trace).toMatch(/render\s+renderToString/)
      expect(trace).toMatch(/plugin\s+nuxt:router/)
      expect(trace).toMatch(/hook\s+app:rendered/)
      expect(trace).not.toContain('@/')
      expect(trace).toMatch(/compile\s+\d+ modules/)
      expect(trace).toMatch(/vite plugins[\s\S]*slowest modules/)
    }
    finally {
      await session.stop()
    }
  }, 240_000)
})
