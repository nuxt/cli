import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

import { findStaticEntry, previewStaticOutput } from '../../../src/utils/static-preview'

function makeOutput(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nuxt-static-preview-'))
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents)
  }
  return dir
}

describe('findStaticEntry', () => {
  it('should prefer `200.html` over `index.html`', () => {
    const dir = makeOutput({ '200.html': 'spa', 'index.html': 'home' })
    expect(findStaticEntry(dir)).toBe(join(dir, '200.html'))
  })

  it('should return nothing for a directory with no client entry', () => {
    expect(findStaticEntry(makeOutput({}))).toBeUndefined()
  })
})

describe('previewStaticOutput', () => {
  it('should serve files from disk and answer unknown paths with the client entry', async () => {
    const dir = makeOutput({ 'index.html': 'home', 'app.js': 'console.log(1)' })

    const server = await previewStaticOutput({ dir, entry: join(dir, 'index.html'), port: '0', hostname: '127.0.0.1' })
    try {
      const origin = server.url!.replace(/\/$/, '')
      await expect(fetch(`${origin}/app.js`).then(r => r.text())).resolves.toBe('console.log(1)')
      await expect(fetch(`${origin}/some/route`).then(r => r.text())).resolves.toBe('home')
    }
    finally {
      await server.close(true)
    }
  })
})
