import type { Nuxt } from '@nuxt/schema'

import { resolve } from 'pathe'

/** Default output locations Nuxt uses when no server builder declares its own. */
const DEFAULT_OUTPUT_DIR = '.output'
const DEFAULT_PUBLIC_DIR = '.output/public'

/** What a deploy target is called when the builder does not say. */
const DEFAULT_TARGET_LABEL = 'preset'

/**
 * A server builder as the CLI needs to see it: what to call it, an optional
 * deploy target within it, what it can do, where its build lands and how to
 * preview it.
 *
 * Everything a builder can move during its own init is a getter rather than a
 * value: Nitro resolves its preset and then `nitro:config` and
 * `nitro.updateConfig()` can each change `output.dir`, so a snapshot taken
 * before the build can be wrong by the time it is used.
 */
export interface ServerBuild {
  /** The configured server builder, e.g. `nitro` or `vite`. */
  name: string
  /** The builder's display name, e.g. `Nitro` or `Vite SPA`. */
  label: string
  /** What the builder calls its deploy target axis, e.g. `preset`. */
  targetLabel: string
  /** Whether Nuxt described this build itself, rather than the CLI inferring it. */
  declared: boolean
  /** Whether this build produces a server runtime. */
  hasServer: boolean
  /** Whether this builder can serve `nuxt dev`. */
  hasDevServer: boolean
  /** The deploy target within the builder, e.g. a Nitro preset. */
  readonly target: string | undefined
  /** Root of the build output. */
  readonly dir: string
  /** Static output served from the root of the deployment. */
  readonly publicDir: string
  /** Command that runs this build locally, when it has a server to run. */
  readonly previewCommand: string | undefined
  /** Directory to serve when this build is static only. */
  readonly previewStaticDir: string | undefined
}

/** The descriptor recent Nuxt publishes as `nuxt.serverBuild`. */
interface NuxtServerBuild {
  name: string
  label?: string
  target?: () => string | undefined
  targetLabel?: string
  output: { dir: () => string, publicDir: () => string }
  capabilities: { server: boolean, dev: boolean }
  preview?: {
    command?: () => string | undefined
    staticDir?: () => string
  }
}

/**
 * Nuxt fields the CLI reads optimistically: they exist in recent Nuxt only, and
 * the CLI supports a range of versions.
 */
interface MaybeModernNuxt extends Nuxt {
  serverBuild?: NuxtServerBuild
  options: Nuxt['options'] & { server?: { builder?: unknown } }
}

interface MaybeModernKit {
  tryUseNitro?: () => NitroLike | undefined
  useNitro: () => NitroLike
}

interface NitroLike {
  options: {
    preset?: string
    output?: { dir?: string, publicDir?: string }
    commands?: { preview?: string }
  }
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
 * The display name of the configured server builder.
 *
 * Nuxt describes it on `nuxt.serverBuild`; older versions are read from the
 * `server.builder` option, where a module specifier such as `@nuxt/vite-server`
 * reads as `vite`.
 */
export function getServerBuilderName(nuxt: Nuxt, hasServer?: boolean): string {
  const declared = (nuxt as MaybeModernNuxt).serverBuild
  if (declared) {
    return declared.label || declared.name
  }

  const name = inferBuilderName(nuxt)
  if (name === 'nitro') {
    return 'Nitro'
  }
  if (name) {
    return name
  }
  // Nuxt versions without `server.builder` only ever built with Nitro.
  return hasServer === false ? 'unknown' : 'Nitro'
}

/**
 * The server builder named by the `server.builder` option, for Nuxt versions
 * that do not describe the build themselves.
 */
function inferBuilderName(nuxt: Nuxt): string | undefined {
  const builder = (nuxt as MaybeModernNuxt).options.server?.builder
  if (typeof builder === 'string' && builder) {
    return builder.replace(/^@nuxt\//, '').replace(/-server$/, '')
  }
  return builder ? 'custom' : undefined
}

/**
 * Describe a loaded Nuxt instance's build in builder-agnostic terms.
 *
 * `nuxt.serverBuild` answers all of this where it exists; otherwise it is
 * reconstructed from the Nitro instance and Nuxt's defaults, so the CLI keeps
 * working against Nuxt versions that predate the descriptor.
 */
export function resolveServerBuild(kit: MaybeModernKit, nuxt: Nuxt): ServerBuild {
  const declared = (nuxt as MaybeModernNuxt).serverBuild
  const nitro = declared?.capabilities.server === false ? undefined : tryUseNitro(kit)

  return {
    name: declared?.name ?? inferBuilderName(nuxt) ?? (nitro ? 'nitro' : 'unknown'),
    label: getServerBuilderName(nuxt, !!nitro),
    targetLabel: declared?.targetLabel ?? DEFAULT_TARGET_LABEL,
    declared: !!declared,
    hasServer: declared?.capabilities.server ?? !!nitro,
    hasDevServer: declared?.capabilities.dev ?? true,
    get target() {
      return declared ? declared.target?.() : nitro?.options.preset
    },
    get dir() {
      return declared?.output.dir()
        ?? nitro?.options.output?.dir
        ?? resolve(nuxt.options.rootDir, nuxt.options.nitro?.output?.dir || DEFAULT_OUTPUT_DIR)
    },
    get publicDir() {
      return declared?.output.publicDir()
        ?? nitro?.options.output?.publicDir
        ?? resolve(nuxt.options.rootDir, nuxt.options.nitro?.output?.publicDir || DEFAULT_PUBLIC_DIR)
    },
    get previewCommand() {
      return declared ? declared.preview?.command?.() : nitro?.options.commands?.preview
    },
    get previewStaticDir() {
      return declared ? declared.preview?.staticDir?.() : undefined
    },
  }
}
