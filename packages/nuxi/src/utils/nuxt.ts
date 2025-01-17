import type { Nuxt } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'

import { hash } from 'ohash'
import { dirname, resolve } from 'pathe'

import { logger } from '../utils/logger'
import { rmRecursive } from './fs'

interface NuxtProjectManifest {
  _hash: string | null
  project: {
    rootDir: string
  }
  versions: {
    nuxt: string
  }
}

export async function cleanupNuxtDirs(rootDir: string, buildDir: string) {
  logger.info('Cleaning up generated Nuxt files and caches...')

  await rmRecursive(
    [
      buildDir,
      '.output',
      'dist',
      'node_modules/.vite',
      'node_modules/.cache',
    ].map(dir => resolve(rootDir, dir)),
  )
}

export function nuxtVersionToGitIdentifier(version: string) {
  // match the git identifier in the release, for example: 3.0.0-rc.8-27677607.a3a8706
  const id = /\.([0-9a-f]{7,8})$/.exec(version)
  if (id?.[1]) {
    return id[1]
  }
  // match github tag, for example 3.0.0-rc.8
  return `v${version}`
}

export function resolveNuxtManifest(nuxt: Nuxt): NuxtProjectManifest {
  const manifest: NuxtProjectManifest = {
    _hash: null,
    project: {
      rootDir: nuxt.options.rootDir,
    },
    versions: {
      nuxt: nuxt._version,
    },
  }
  manifest._hash = hash(manifest)
  return manifest
}

export async function writeNuxtManifest(nuxt: Nuxt, manifest = resolveNuxtManifest(nuxt)): Promise<NuxtProjectManifest> {
  const manifestPath = resolve(nuxt.options.buildDir, 'nuxt.json')
  await fsp.mkdir(dirname(manifestPath), { recursive: true })
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  return manifest
}

export async function loadNuxtManifest(buildDir: string): Promise<NuxtProjectManifest | null> {
  const manifestPath = resolve(buildDir, 'nuxt.json')
  const manifest: NuxtProjectManifest | null = await fsp
    .readFile(manifestPath, 'utf-8')
    .then(data => JSON.parse(data) as NuxtProjectManifest)
    .catch(() => null)
  return manifest
}
