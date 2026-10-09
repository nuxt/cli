import { parseArgs } from 'citty'
import { describe, expect, it } from 'vitest'

import { TUNNEL_FLAG_VALUES } from '../../../src/dev/tunnel/types'
import { normalizeOptionalValueFlag } from '../../../src/utils/optional-flag'

function parse(argv: string[]) {
  const rawArgs = [...argv]
  normalizeOptionalValueFlag(rawArgs, '--tunnel', TUNNEL_FLAG_VALUES)
  const { _, ...args } = parseArgs(rawArgs, {
    rootDir: { type: 'positional', required: false },
    tunnel: { type: 'string' },
    port: { type: 'string' },
  })
  return { tunnel: args.tunnel as string | boolean | undefined, rootDir: args.rootDir, port: args.port }
}

describe('normalizeOptionalValueFlag', () => {
  it('should leave a bare flag empty instead of taking the next flag as its value', () => {
    expect(parse(['--tunnel', '--port', '3000'])).toEqual({ tunnel: '', rootDir: undefined, port: '3000' })
  })

  it('should not take the project directory as the value', () => {
    expect(parse(['--tunnel', './app'])).toEqual({ tunnel: '', rootDir: './app', port: undefined })
    expect(parse(['./app', '--tunnel'])).toEqual({ tunnel: '', rootDir: './app', port: undefined })
  })

  it('should keep a known value, given either way', () => {
    expect(parse(['--tunnel', 'opentunnel']).tunnel).toBe('opentunnel')
    expect(parse(['--tunnel=opentunnel']).tunnel).toBe('opentunnel')
    expect(parse(['--tunnel', 'cloudflared']).tunnel).toBe('cloudflared')
  })

  it('should leave an explicit unknown value for the caller to report', () => {
    expect(parse(['--tunnel=ngrok']).tunnel).toBe('ngrok')
  })

  it('should leave negation and arguments after `--` alone', () => {
    expect(parse(['--no-tunnel']).tunnel).toBe(false)
    const rawArgs = ['--', '--tunnel', './app']
    normalizeOptionalValueFlag(rawArgs, '--tunnel', TUNNEL_FLAG_VALUES)
    expect(rawArgs).toEqual(['--', '--tunnel', './app'])
  })
})
