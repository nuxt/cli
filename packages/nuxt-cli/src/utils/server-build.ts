import type { Nuxt } from '@nuxt/schema'

import { resolve } from 'pathe'

/** Default output locations Nuxt uses when no server builder declares its own. */
const DEFAULT_OUTPUT_DIR = '.output'
const DEFAULT_PUBLIC_DIR = '.output/public'

/**
 * A server builder as the CLI needs to see it: a name to print, an optional
 * deploy target within that builder, whether a server runtime exists, and where
 * the build lands.
 *
 * `dir` and `publicDir` are getters, not values: a builder may still move its
 * output after `nuxt.ready()` (Nitro resolves its preset, then `nitro:config`
 * and `nitro.updateConfig()` can both change `output.dir`), so a snapshot taken
 * before the build can be wrong by the time it is used.
 */
export interface ServerBuild {
  /** The configured server builder, e.g. `nitro` or `vite`. */
  name: string
  /** A deploy target within that builder, e.g. a Nitro preset. */
  target: string | undefined
  /** Whether this build produced a server runtime at all. */
  hasServer: boolean
  /** Root of the build output. */
  readonly dir: string
  /** Static output served from the root of the deployment. */
  readonly publicDir: string
}

/**
 * Nuxt fields the CLI reads optimistically: they exist in recent Nuxt only, and
 * the CLI supports a range of versions.
 */
interface MaybeModernNuxt extends Nuxt {
  serverOutput?: { dir: () => string, publicDir: () => string }
  options: Nuxt['options'] & { server?: { builder?: unknown } }
}

interface MaybeModernKit {
  tryUseNitro?: () => NitroLike | undefined
  useNitro: () => NitroLike
}

interface NitroLike {
  options: { preset?: string, output?: { dir?: string, publicDir?: string } }
}

/**
 * The Nitro instance for this build, or `undefined` when the configured server
 * builder did not create one.
 *
 * `tryUseNitro` is only present in newer `@nuxt/kit`; on older versions
 * `useNitro` throwing means the same thing.
 */
export function tryUseNitro(kit: MaybeModernKit): NitroLike | undefined {
  if (typeof kit.tryUseNitro === 'function') {
    return kit.tryUseNitro()
  }
  try {
    return kit.useNitro()
  }
  catch {
    return undefined
  }
}

/**
 * The name of the configured server builder, normalised for display: a module
 * specifier such as `@nuxt/vite-server` reads as `vite`.
 */
export function getServerBuilderName(nuxt: Nuxt, hasServer?: boolean): string {
  const builder = (nuxt as MaybeModernNuxt).options.server?.builder
  if (typeof builder === 'string' && builder) {
    return builder.replace(/^@nuxt\//, '').replace(/-server$/, '')
  }
  if (builder) {
    return 'custom'
  }
  // Nuxt versions without `server.builder` only ever built with Nitro.
  return hasServer === false ? 'unknown' : 'nitro'
}

/**
 * Describe a loaded Nuxt instance's build in builder-agnostic terms.
 *
 * Output paths come from `nuxt.serverOutput` where available, falling back to
 * the Nitro instance and then to Nuxt's defaults, so this works against Nuxt
 * versions that predate either.
 */
export function resolveServerBuild(kit: MaybeModernKit, nuxt: Nuxt): ServerBuild {
  const nitro = tryUseNitro(kit)
  const serverOutput = (nuxt as MaybeModernNuxt).serverOutput

  return {
    name: getServerBuilderName(nuxt, !!nitro),
    target: nitro?.options.preset,
    hasServer: !!nitro,
    get dir() {
      return serverOutput?.dir()
        ?? nitro?.options.output?.dir
        ?? resolve(nuxt.options.rootDir, nuxt.options.nitro?.output?.dir || DEFAULT_OUTPUT_DIR)
    },
    get publicDir() {
      return serverOutput?.publicDir()
        ?? nitro?.options.output?.publicDir
        ?? resolve(nuxt.options.rootDir, nuxt.options.nitro?.output?.publicDir || DEFAULT_PUBLIC_DIR)
    },
  }
}
