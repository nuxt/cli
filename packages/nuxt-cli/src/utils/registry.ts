import type { FileHandle } from 'node:fs/promises'

import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { parseINI } from 'confbox'

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

export function getRegistryFromContent(content: string, scope: string | null): string | null {
  try {
    const npmConfig = parseINI<Record<string, string | undefined>>(content)

    if (scope) {
      const scopeKey = `${scope}:registry`
      if (npmConfig[scopeKey]) {
        return npmConfig[scopeKey].trim()
      }
    }

    if (npmConfig.registry) {
      return npmConfig.registry.trim()
    }

    return null
  }
  catch {
    return null
  }
}

/**
 * `.npmrc` files to consult, most specific first. Without a `cwd` only the user's
 * own file is read, for requests a project should not be able to redirect.
 */
function getNpmrcPaths(cwd: string | undefined): string[] {
  return cwd ? [join(cwd, '.npmrc'), join(homedir(), '.npmrc')] : [join(homedir(), '.npmrc')]
}

async function getRegistryFromFile(paths: string[], scope: string | null) {
  for (const npmrcPath of paths) {
    let fd: FileHandle | undefined
    try {
      fd = await fs.promises.open(npmrcPath, 'r')
      if (await fd.stat().then(r => r.isFile())) {
        const npmrcContent = await fd.readFile('utf-8')
        const registry = getRegistryFromContent(npmrcContent, scope)

        if (registry) {
          return registry
        }
      }
    }
    catch {
      // swallow errors as file does not exist
    }
    finally {
      await fd?.close()
    }
  }
  return null
}

async function getRegistry(scope: string | null, cwd: string | undefined): Promise<string> {
  const registry = process.env.COREPACK_NPM_REGISTRY
    || await getRegistryFromFile(getNpmrcPaths(cwd), scope)
    || PUBLIC_REGISTRY

  return registry.replace(TRAILING_SLASH_RE, '')
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

function readCredentials(config: Record<string, string | undefined>, registry: string): Pick<RegistryMeta, 'authToken' | 'authorization'> | undefined {
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

async function getCredentials(registry: RegistryMeta['registry'], cwd: string | undefined): Promise<Pick<RegistryMeta, 'authToken' | 'authorization'>> {
  for (const npmrcPath of getNpmrcPaths(cwd)) {
    let fd: FileHandle | undefined
    try {
      fd = await fs.promises.open(npmrcPath, 'r')
      if (await fd.stat().then(r => r.isFile())) {
        const config = parseINI<Record<string, string | undefined>>(await fd.readFile('utf-8'))
        const credentials = readCredentials(config, registry)
        if (credentials) {
          return credentials
        }
      }
    }
    catch {
      // swallow errors as file does not exist
    }
    finally {
      await fd?.close()
    }
  }

  return { authToken: null, authorization: null }
}

/**
 * Registry and credentials for `scope`, from the project's `.npmrc` in `cwd`
 * (defaulting to the working directory) and then the user's. Pass `null` as
 * `cwd` to ignore project configuration entirely: a project `.npmrc` may name any
 * host and, as in `npm`, reference environment variables in its credentials, so
 * a request the user did not ask for should not be steered by it.
 */
export async function detectNpmRegistry(scope: string | null, cwd: string | null = process.cwd()): Promise<RegistryMeta> {
  const paths = cwd ?? undefined
  const registry = await getRegistry(scope, paths)

  return {
    registry,
    ...await getCredentials(registry, paths),
  }
}
