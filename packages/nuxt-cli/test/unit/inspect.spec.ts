import { describe, expect, it } from 'vitest'

import { parseInspectArgs } from '../../src/dev/inspect'

describe('parseInspectArgs', () => {
  it('should return undefined when the inspector is not requested', () => {
    expect(parseInspectArgs([])).toBeUndefined()
    expect(parseInspectArgs(['--port', '3000', '--open'])).toBeUndefined()
  })

  it('should use node defaults for a bare `--inspect`', () => {
    expect(parseInspectArgs(['--inspect'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: false })
  })

  it('should parse a port only value', () => {
    expect(parseInspectArgs(['--inspect=3050'])).toStrictEqual({ host: '127.0.0.1', port: 3050, wait: false })
  })

  it('should parse a host and port value', () => {
    expect(parseInspectArgs(['--inspect=0.0.0.0:3050'])).toStrictEqual({ host: '0.0.0.0', port: 3050, wait: false })
  })

  it('should parse a host only value', () => {
    expect(parseInspectArgs(['--inspect=0.0.0.0'])).toStrictEqual({ host: '0.0.0.0', port: 9229, wait: false })
  })

  it('should parse bracketed ipv6 hosts', () => {
    expect(parseInspectArgs(['--inspect=[::]:3050'])).toStrictEqual({ host: '::', port: 3050, wait: false })
    expect(parseInspectArgs(['--inspect=[::1]'])).toStrictEqual({ host: '::1', port: 9229, wait: false })
  })

  it('should preserve `--inspect-brk` semantics', () => {
    expect(parseInspectArgs(['--inspect-brk'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: true })
    expect(parseInspectArgs(['--inspect-brk=0.0.0.0:3050'])).toStrictEqual({ host: '0.0.0.0', port: 3050, wait: true })
    expect(parseInspectArgs(['--inspect-wait'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: true })
  })

  it('should apply `--inspect-port` without enabling the inspector on its own', () => {
    expect(parseInspectArgs(['--inspect-port=3050'])).toBeUndefined()
    expect(parseInspectArgs(['--inspect', '--inspect-port=3050'])).toStrictEqual({ host: '127.0.0.1', port: 3050, wait: false })
    expect(parseInspectArgs(['--inspect-port=0.0.0.0:3050', '--inspect'])).toStrictEqual({ host: '0.0.0.0', port: 3050, wait: false })
  })

  it('should ignore unrelated arguments that mention inspect', () => {
    expect(parseInspectArgs(['--inspect-publish-uid=http'])).toBeUndefined()
    expect(parseInspectArgs(['--no-inspect'])).toBeUndefined()
    expect(parseInspectArgs(['./pages/--inspect.vue'])).toBeUndefined()
  })

  it('should let the last value win', () => {
    expect(parseInspectArgs(['--inspect=3050', '--inspect=9230'])).toStrictEqual({ host: '127.0.0.1', port: 9230, wait: false })
  })

  it('should ignore invalid ports', () => {
    expect(parseInspectArgs(['--inspect=99999'])).toStrictEqual({ host: '127.0.0.1', port: 9229, wait: false })
  })
})
