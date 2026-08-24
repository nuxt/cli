import { describe, expect, it } from 'vitest'

import { isAllowedHost, parseHostHeader } from '../../src/dev/host-check'

describe('parseHostHeader', () => {
  it('strips the port', () => {
    expect(parseHostHeader('example.com:3000')).toBe('example.com')
  })

  it('lowercases the hostname', () => {
    expect(parseHostHeader('EXAMPLE.com')).toBe('example.com')
  })

  it('unwraps bracketed IPv6 literals', () => {
    expect(parseHostHeader('[::1]:3000')).toBe('::1')
  })

  it('returns undefined for empty or malformed values', () => {
    expect(parseHostHeader(undefined)).toBeUndefined()
    expect(parseHostHeader('')).toBeUndefined()
    expect(parseHostHeader(':3000')).toBeUndefined()
    expect(parseHostHeader('[')).toBeUndefined()
  })
})

describe('isAllowedHost', () => {
  const none = new Set<string>()

  it('accepts a missing Host header', () => {
    expect(isAllowedHost(undefined, none)).toBe(true)
  })

  it('accepts localhost and .localhost subdomains', () => {
    expect(isAllowedHost('localhost:3000', none)).toBe(true)
    expect(isAllowedHost('app.localhost', none)).toBe(true)
  })

  it('accepts IP literals', () => {
    expect(isAllowedHost('127.0.0.1:3000', none)).toBe(true)
    expect(isAllowedHost('192.168.1.20:3000', none)).toBe(true)
    expect(isAllowedHost('[::1]:3000', none)).toBe(true)
  })

  it('accepts hostnames on the allowlist, case-insensitively', () => {
    const allowed = new Set(['dev.example.com'])
    expect(isAllowedHost('dev.example.com:3000', allowed)).toBe(true)
    expect(isAllowedHost('DEV.example.com', allowed)).toBe(true)
  })

  it('rejects hostnames not on the allowlist', () => {
    expect(isAllowedHost('rebinding-attacker.com:3000', none)).toBe(false)
    expect(isAllowedHost('localhost.evil.com', none)).toBe(false)
  })

  it('rejects malformed Host values', () => {
    expect(isAllowedHost('[', none)).toBe(false)
  })
})
