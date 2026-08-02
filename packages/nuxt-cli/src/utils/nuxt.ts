import type { Nuxt } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'

import { hash } from 'ohash'
import { dirname, resolve } from 'pathe'

import { debug, logger } from '../utils/logger'

const GIT_ID_RE = /\.([0-9a-f]{7,8})$/

interface NuxtProjectManifest {
  _hash: string | null
  project: {
    rootDir: string
  }
  versions: {
    nuxt: string
  }
}

export async function cleanupNuxtDirs(rootDir: string, buildDir: string, options: { silent?: boolean } = {}) {
  const root = resolve(rootDir)
  const build = resolve(root, buildDir)
  if (build === root || root.startsWith(build.endsWith('/') ? build : `${build}/`)) {
    throw new Error('Cannot clean a build directory that contains the project root.')
  }

  if (!options.silent) {
    logger.info('Cleaning up generated Nuxt files and caches...')
  }

  const paths = new Set([
    build,
    '.output',
    'dist',
    'node_modules/.vite',
    'node_modules/.cache',
  ].map(dir => resolve(root, dir)))

  await Promise.all([...paths].map((path) => {
    debug(`Removing recursive path: ${path}`)
    return fsp.rm(path, { recursive: true, force: true })
  }))
}

export function nuxtVersionToGitIdentifier(version: string) {
  // match the git identifier in the release, for example: 3.0.0-rc.8-27677607.a3a8706
  const id = GIT_ID_RE.exec(version)
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
