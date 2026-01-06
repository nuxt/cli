import type { UserConfig } from 'tsdown'
import process from 'node:process'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'tsdown'
import { purgePolyfills } from 'unplugin-purge-polyfills'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineConfig({
  entry: ['src/index.ts', 'src/dev/index.ts'],
  shims: true,
  fixedExtension: true,
  dts: !isAnalysingSize && {
    oxc: true,
  },
  failOnWarn: !isAnalysingSize,
  plugins: [
    purgePolyfills.rolldown({ logLevel: 'verbose' }),
    ...(isAnalysingSize ? [visualizer({ template: 'raw-data' })] : []),
  ],
}) satisfies UserConfig as UserConfig
