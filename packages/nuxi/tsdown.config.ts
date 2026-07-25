import type { UserConfig } from 'tsdown'
import process from 'node:process'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'tsdown'
import { purgePolyfills } from 'unplugin-purge-polyfills'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/dev/index.ts'],
  shims: true,
  fixedExtension: true,
  deps: { onlyBundle: false },
  dts: !isAnalysingSize && {
    oxc: true,
    // the dev entry is only a fork target and is not exposed to consumers, and
    // declarations for it inline the whole of `@nuxt/schema`
    entry: ['src/index.ts'],
  },
  // disabled due to upstream DTS warnings from @nuxt/schema type imports
  failOnWarn: false,
  plugins: [
    purgePolyfills.rolldown({ logLevel: 'verbose' }),
    ...(isAnalysingSize ? [visualizer({ template: 'raw-data' })] : []),
  ],
}) satisfies UserConfig as UserConfig
