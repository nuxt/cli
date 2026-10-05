import type { FileHandle } from 'node:fs/promises'

import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { parseINI } from 'confbox/ini'

const TRAILING_SLASH_RE = /\/$/
const ENV_REFERENCE_RE = /\$\{([^}]+)\}/g

/** The registry every public package can be read from, whatever else is configured. */
export const PUBLIC_REGISTRY = 'https://registry.npmjs.org'

export interface RegistryMeta {
  /** Registry URL without a trailing slash, so paths can be appended directly. */
  registry: string
  authToken: string | null
  /** `Authorization` header value for {@link registry}, from a token or basic credentials. */
  authorization: string | null
}

type NpmConfig = Record<string, string | undefined>

function registryFromConfig(config: NpmConfig, scope: string | null): string | null {
  return (scope && config[`${scope}:registry`]?.trim()) || config.registry?.trim() || null
}

export function getRegistryFromContent(content: string, scope: string | null): string | null {
  try {
    return registryFromConfig(parseINI<NpmConfig>(content), scope)
  }
  catch {
    return null
  }
}

/** Parsed `.npmrc` files, most specific first; only the user file without a `cwd`. */
async function readNpmrcs(cwd: string | undefined): Promise<NpmConfig[]> {
  const paths = cwd ? [join(cwd, '.npmrc'), join(homedir(), '.npmrc')] : [join(homedir(), '.npmrc')]
  const configs = await Promise.all(paths.map(async (npmrcPath) => {
    let fd: FileHandle | undefined
    try {
      fd = await fs.promises.open(npmrcPath, 'r')
      if (await fd.stat().then(r => r.isFile())) {
        return parseINI<NpmConfig>(await fd.readFile('utf-8'))
      }
    }
    catch {}
    finally {
      await fd?.close()
    }
  }))
  return configs.filter(c => !!c)
}

/**
 * `npm` credentials apply to a registry URL prefix, not just a host, so a registry
 * served from a path (`https://host/npm/`) is configured as
 * `//host/npm/:_authToken`. Each prefix is tried from the most specific down to
 * the bare host, as `npm` does.
 */
function authKeyPrefixes(registry: string): string[] {
  let url: URL
  try {
    url = new URL(registry)
  }
  catch {
    return []
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const prefixes: string[] = []
  for (let depth = segments.length; depth >= 0; depth--) {
    prefixes.push(`//${url.host}${segments.slice(0, depth).map(segment => `/${segment}`).join('')}/`)
  }
  return prefixes
}

/** `npm` expands `${VAR}` in `.npmrc` values from the environment. */
function expand(value: string): string {
  return value.trim().replace(ENV_REFERENCE_RE, (match, name: string) => process.env[name] ?? match)
}

function readCredentials(config: NpmConfig, registry: string): Pick<RegistryMeta, 'authToken' | 'authorization'> | undefined {
  for (const prefix of authKeyPrefixes(registry)) {
    const token = config[`${prefix}:_authToken`]
    if (token) {
      const authToken = expand(token)
      return { authToken, authorization: `Bearer ${authToken}` }
    }
    const auth = config[`${prefix}:_auth`]
    if (auth) {
      return { authToken: null, authorization: `Basic ${expand(auth)}` }
    }
    const username = config[`${prefix}:username`]
    const password = config[`${prefix}:_password`]
    if (username && password) {
      // `_password` is stored base64-encoded, while the header wants the pair encoded together.
      const decoded = Buffer.from(expand(password), 'base64').toString('utf8')
      return { authToken: null, authorization: `Basic ${Buffer.from(`${expand(username)}:${decoded}`).toString('base64')}` }
    }
  }
}

/**
 * Registry and credentials for `scope`, from the project's `.npmrc` in `cwd`
 * (defaulting to the working directory) and then the user's. Pass `null` as
 * `cwd` to ignore project configuration entirely: a project `.npmrc` may name any
 * host and, as in `npm`, reference environment variables in its credentials, so
 * a request the user did not ask for should not be steered by it.
 */
export async function detectNpmRegistry(scope: string | null, cwd: string | null = process.cwd()): Promise<RegistryMeta> {
  const configs = await readNpmrcs(cwd ?? undefined)
  const registry = (process.env.COREPACK_NPM_REGISTRY
    || configs.map(config => registryFromConfig(config, scope)).find(Boolean)
    || PUBLIC_REGISTRY).replace(TRAILING_SLASH_RE, '')

  for (const config of configs) {
    const credentials = readCredentials(config, registry)
    if (credentials) {
      return { registry, ...credentials }
    }
  }
  return { registry, authToken: null, authorization: null }
}
