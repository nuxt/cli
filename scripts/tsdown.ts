import type { UserConfig } from 'tsdown'

import process from 'node:process'
import { externals } from 'nf3/plugin'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'tsdown'
import { purgePolyfills } from 'unplugin-purge-polyfills'

/** Parser packages resolved from the user's project rather than shipped by us. */
export const PARSER_PACKAGES = ['rolldown', 'oxc-parser']

/** The specifiers those parsers are imported by, as they must appear in the emitted chunks. */
export const PARSER_SPECIFIERS = ['rolldown/utils', 'oxc-parser']

/**
 * What the built `dist` must look like, asserted by `scripts/check-dist.ts`.
 *
 * Declared next to the build config so the two cannot drift apart, and exported
 * from each `tsdown.config.ts` as `packaging` so the check can read it.
 */
export interface PackagingContract {
  /**
   * Dependencies traced into `dist/node_modules` instead of being bundled, for
   * packages that read their own files off disk at runtime.
   */
  traced?: string[]
  /** Specifiers that must survive the build as bare imports. */
  external?: string[]
}

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export function defineCliConfig(config: UserConfig & PackagingContract): UserConfig {
  const { traced = [], external: _external, dts, plugins = [], ...rest } = config

  return defineConfig({
    fixedExtension: true,
    failOnWarn: !isAnalysingSize,
    ...rest,
    dts: !isAnalysingSize && { oxc: true, ...(typeof dts === 'object' ? dts : {}) },
    plugins: [
      ...(traced.length ? [externals({ include: traced })] : []),
      purgePolyfills.rolldown({ logLevel: 'verbose' }),
      ...(isAnalysingSize ? [visualizer({ template: 'raw-data' })] : []),
      ...(Array.isArray(plugins) ? plugins : [plugins]),
    ],
  }) satisfies UserConfig as UserConfig
}
