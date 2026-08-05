import type { FileHandle } from 'node:fs/promises'

import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { parseINI } from 'confbox'

const PROTOCOL_RE = /^https?:\/\//
const TRAILING_SLASH_RE = /\/$/

export interface RegistryMeta {
  /** Registry URL without a trailing slash, so paths can be appended directly. */
  registry: string
  authToken: string | null
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

function getNpmrcPaths(cwd: string): string[] {
  return [join(cwd, '.npmrc'), join(homedir(), '.npmrc')]
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

async function getRegistry(scope: string | null, cwd: string): Promise<string> {
  const registry = process.env.COREPACK_NPM_REGISTRY
    || await getRegistryFromFile(getNpmrcPaths(cwd), scope)
    || 'https://registry.npmjs.org'

  return registry.replace(TRAILING_SLASH_RE, '')
}

async function getAuthToken(registry: RegistryMeta['registry'], cwd: string): Promise<RegistryMeta['authToken']> {
  const paths = getNpmrcPaths(cwd)
  const registryHost = registry.replace(PROTOCOL_RE, '')
  const authTokenKey = `//${registryHost}/:_authToken`

  for (const npmrcPath of paths) {
    let fd: FileHandle | undefined
    try {
      fd = await fs.promises.open(npmrcPath, 'r')
      if (await fd.stat().then(r => r.isFile())) {
        const npmrcContent = await fd.readFile('utf-8')
        const npmConfig = parseINI<Record<string, string | undefined>>(npmrcContent)
        const authToken = npmConfig[authTokenKey]

        if (authToken) {
          return authToken.trim()
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

export async function detectNpmRegistry(scope: string | null, cwd = process.cwd()): Promise<RegistryMeta> {
  const registry = await getRegistry(scope, cwd)
  const authToken = await getAuthToken(registry, cwd)

  return {
    registry,
    authToken,
  }
}
