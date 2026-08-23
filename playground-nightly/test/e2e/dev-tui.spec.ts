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

async function runDevUI(port: number): Promise<string> {
  const session = record(`NUXT_IGNORE_LOCK=1 NUXT_TUI=1 node ${bin} dev --port ${port} --no-takeover`, {
    cwd,
    rows: 40,
    columns: 100,
    env: {},
  })
  try {
    await session.waitFor(/watching for changes/, 180_000)
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
})
