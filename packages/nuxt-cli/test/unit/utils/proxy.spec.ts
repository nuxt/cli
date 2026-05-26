import process from 'node:process'

import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installProxyDispatcher } from '../../../src/utils/proxy'

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

describe('installProxyDispatcher', () => {
  let originalDispatcher: ReturnType<typeof getGlobalDispatcher>
  let originalEnv: Partial<Record<typeof PROXY_ENV_KEYS[number], string | undefined>>

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher()
    originalEnv = Object.fromEntries(
      PROXY_ENV_KEYS.map(key => [key, process.env[key]]),
    )
    for (const key of PROXY_ENV_KEYS) {
      delete process.env[key]
    }
    setGlobalDispatcher(new Agent())
  })

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher)
    for (const key of PROXY_ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) {
        delete process.env[key]
      }
      else {
        process.env[key] = value
      }
    }
  })

  it('leaves the default Agent in place when no proxy env var is set', () => {
    const before = getGlobalDispatcher()
    installProxyDispatcher()
    expect(getGlobalDispatcher()).toBe(before)
  })

  it('swaps the default Agent for EnvHttpProxyAgent when HTTPS_PROXY is set', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080'
    installProxyDispatcher()
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent)
  })

  it('picks up lowercase http_proxy', () => {
    process.env.http_proxy = 'http://proxy.example.com:8080'
    installProxyDispatcher()
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent)
  })

  it('is idempotent when an EnvHttpProxyAgent is already installed', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080'
    const existing = new EnvHttpProxyAgent()
    setGlobalDispatcher(existing)
    installProxyDispatcher()
    expect(getGlobalDispatcher()).toBe(existing)
  })

  it('leaves a user-installed non-default dispatcher alone', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080'
    const userDispatcher = new ProxyAgent('http://user-proxy.example.com:8080')
    setGlobalDispatcher(userDispatcher)
    installProxyDispatcher()
    expect(getGlobalDispatcher()).toBe(userDispatcher)
  })

  it('leaves a user subclass of Agent alone', () => {
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080'
    class CustomAgent extends Agent {}
    const userDispatcher = new CustomAgent()
    setGlobalDispatcher(userDispatcher)
    installProxyDispatcher()
    expect(getGlobalDispatcher()).toBe(userDispatcher)
  })
})
