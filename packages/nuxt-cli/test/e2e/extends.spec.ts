import { fileURLToPath } from 'node:url'
import { getPort } from 'get-port-please'
import { x } from 'tinyexec'
import { describe, expect, it } from 'vitest'

import { fetchWithPolling } from '../utils'

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

describe('extends support', () => {
  it('works with dev server', async () => {
    const controller = new AbortController()
    const port = await getPort({ host: '127.0.0.1', port: 3003 })
    const devProcess = x(nuxi, ['dev', `--host=127.0.0.1`, `--port=${port}`, '--extends=some-layer'], {
      nodeOptions: { stdio: 'pipe', cwd: fixtureDir },
      signal: controller.signal,
    })

    // Test that server responds
    const response = await fetchWithPolling(`http://127.0.0.1:${port}/extended`, {}, 30, 300)
    expect.soft(response?.status).toBe(200)
    expect(await response?.text()).toContain('This is an extended page from a layer.')

    controller.abort()
    try {
      await devProcess
    }
    catch {}
  })
})
