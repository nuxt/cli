import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { renderSelfUpdateNudge, renderUpdateNudge } from '../../src/utils/update-check'

function capture(run: () => void, { hyperlinks }: { hyperlinks: boolean }): string {
  let output = ''
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  // Terminal detection has many inputs; this is the switch that overrides them.
  vi.stubEnv('FORCE_HYPERLINK', hyperlinks ? '1' : '0')
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    output += String(chunk)
    return true
  })
  try {
    run()
  }
  finally {
    write.mockRestore()
    vi.unstubAllEnvs()
    if (descriptor) {
      Object.defineProperty(process.stdout, 'isTTY', descriptor)
    }
    else {
      Reflect.deleteProperty(process.stdout, 'isTTY')
    }
  }
  return output
}

describe('update nudge', () => {
  it('links the new version to its release notes', () => {
    const output = capture(() => renderUpdateNudge({ current: '4.5.1', latest: '4.6.0' }), { hyperlinks: true })
    expect(output).toContain('https://github.com/nuxt/nuxt/releases/tag/v4.6.0')
    expect(output).toContain('4.6.0')
  })

  it('links the CLI\'s own releases when nudging about itself', () => {
    const output = capture(() => renderSelfUpdateNudge({ current: '3.0.0', latest: '3.1.0' }), { hyperlinks: true })
    expect(output).toContain('https://github.com/nuxt/cli/releases/tag/v3.1.0')
  })

  it('prints a plain version where hyperlinks are unsupported', () => {
    const output = capture(() => renderUpdateNudge({ current: '4.5.1', latest: '4.6.0' }), { hyperlinks: false })
    expect(output).not.toContain('https://github.com')
    expect(output).toContain('4.6.0')
  })
})
